import 'server-only'
import {
  hygieneRule,
  hygieneRuleKey,
  hygieneSegmentDefinition,
  hygieneSegmentName,
  type HygieneSettings
} from '@/features/audiences/hygiene'
import { logger } from '@/lib/logger'
import {
  KlaviyoError,
  type KlaviyoClient
} from '@/lib/providers/klaviyo/client'
import {
  createSegment,
  findSegmentsByName,
  readHygieneMetrics,
  segmentSize
} from '@/lib/providers/klaviyo/segments'

/**
 * PICK-101 (list hygiene): before the live pusher makes a draft campaign
 * it makes sure GROS's own exclusion segment is in the workspace's Klaviyo
 * (`GROS list hygiene · 180 days · v1`, the rule's people with no clicks,
 * real opens, site visits or orders), and the campaign leaves it out.
 * It runs inside the push, under the email build's push lease (the job
 * this remote work belongs to), behind the same switches: `KLAVIYO_MODE`
 * and `KLAVIYO_DRAFT_PUSH=live`, and the write lock (KLV-LOCK-001), which
 * the client checks again on its own.
 *
 * Made once, then reused: the segment's id is kept per workspace and rule
 * (`klaviyo_hygiene_segments`); a create whose answer was lost is looked
 * up by its exact name before another is ever made, and while another
 * push is making it this push waits. Bounced and suppressed people need
 * no segment: Klaviyo never emails them.
 *
 * Never a reason to hold an email back: with hygiene off, an account
 * without the email metrics (nothing to judge on), a key that cannot write
 * segments, or Klaviyo refusing the definition, the draft goes in without
 * the exclusion and the stored reason says why (tried again a day later).
 */

export type HygieneState = 'creating' | 'ready' | 'no_data' | 'failed'

export type StoredHygieneSegment = {
  state: HygieneState
  segmentId: string | null
  reason: string | null
  createStartedAt: string | null
  profileCount: number | null
  countedAt: string | null
  /** When the row was last written. */
  updatedAt: string
}

export type HygieneStep = Partial<
  Pick<
    StoredHygieneSegment,
    | 'state'
    | 'segmentId'
    | 'reason'
    | 'createStartedAt'
    | 'profileCount'
    | 'countedAt'
  >
>

/** The build's push lease, as the pusher has it. */
export type HygieneRef = { tenantId: string; build: string; lease: string }

export type HygieneStore = {
  /** The owner's setting (the default when he never saved one). */
  settings(tenantId: string): Promise<HygieneSettings>
  load(tenantId: string, ruleKey: string): Promise<StoredHygieneSegment | null>
  /**
   * Saves under the build's push lease. Throws `HygieneBusy` when another
   * push is making this segment right now.
   */
  save(ref: HygieneRef, ruleKey: string, step: HygieneStep): Promise<void>
}

/** Another push is making the segment: wait, never make a second one. */
export class HygieneBusy extends Error {}

/** A no-data or failed answer is tried again after this long. */
export const hygieneRetryMs = 24 * 3600_000
/** The segment's size is read again after this long (a read only). */
export const hygieneRecountMs = 6 * 3600_000
/** A create whose answer was lost may take this long to show. */
export const hygieneShowMs = 120_000

/** What the campaign leaves out, or `wait` (come back; never make twice). */
export type Exclusion = { excluded: string[] } | 'wait'

const none: Exclusion = { excluded: [] }

export async function hygieneExclusion(
  client: KlaviyoClient,
  ref: HygieneRef,
  store: HygieneStore,
  now: () => Date = () => new Date()
): Promise<Exclusion> {
  const rule = hygieneRule(await store.settings(ref.tenantId))
  if (!rule.enabled) return none
  const key = hygieneRuleKey(rule)
  const name = hygieneSegmentName(rule)
  const ago = (iso: string | null) =>
    iso ? now().getTime() - Date.parse(iso) : Number.POSITIVE_INFINITY
  const save = async (step: HygieneStep) => {
    try {
      await store.save(ref, key, step)
      return true
    } catch (error) {
      if (error instanceof HygieneBusy) return false
      throw error
    }
  }
  const ready = async (segmentId: string) => {
    if (!(await save({ state: 'ready', segmentId, reason: null })))
      return 'wait'
    return { excluded: [segmentId] }
  }

  const stored = await store.load(ref.tenantId, key)
  if (stored?.state === 'ready' && stored.segmentId) {
    if (ago(stored.countedAt) >= hygieneRecountMs) {
      // A read only; a failed count never stops the draft.
      const size = await segmentSize(client, stored.segmentId).catch(
        (error: unknown) => {
          if (error instanceof KlaviyoError && error.kind === 'write_locked')
            throw error
          return undefined
        }
      )
      if (size === 'gone') {
        // The owner deleted it in Klaviyo: made again a day later.
        await save({ state: 'failed', reason: 'segment_gone', segmentId: null })
        return none
      }
      if (size !== undefined)
        await save({ profileCount: size, countedAt: now().toISOString() })
    }
    return { excluded: [stored.segmentId] }
  }
  if (
    (stored?.state === 'no_data' || stored?.state === 'failed') &&
    ago(stored.updatedAt) < hygieneRetryMs
  )
    return none

  const metrics = await readHygieneMetrics(client)
  const definition = hygieneSegmentDefinition(rule, metrics)
  if (!definition) {
    await save({
      state: 'no_data',
      reason: metrics.complete ? 'no_email_metrics' : 'metrics_unread',
      segmentId: null
    })
    return none
  }
  // Made before (by a push whose save was lost, or one whose answer was):
  // the oldest is ours; never a second one.
  const found = await findSegmentsByName(client, name)
  if (found[0]) return ready(found[0])
  if (
    stored?.state === 'creating' &&
    ago(stored.createStartedAt) < hygieneShowMs
  )
    return 'wait'
  if (
    !(await save({ state: 'creating', createStartedAt: now().toISOString() }))
  )
    return 'wait'
  let id: string
  try {
    id = await createSegment(client, name, definition)
  } catch (error) {
    if (
      error instanceof KlaviyoError &&
      (error.kind === 'missing_scope' ||
        (error.kind === 'rejected' && error.details.status !== 404))
    ) {
      logger.warn('List hygiene: Klaviyo did not make the segment', {
        build: ref.build,
        kind: error.kind,
        status: error.details.status ?? 0,
        pointer: error.details.pointer ?? 'none'
      })
      await save({
        state: 'failed',
        reason: error.kind === 'missing_scope' ? 'missing_scope' : 'refused'
      })
      return none
    }
    // Unwell or lost: the next try looks it up by name first.
    throw error
  }
  return ready(id)
}
