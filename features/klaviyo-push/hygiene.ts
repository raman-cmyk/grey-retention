import 'server-only'
import {
  hygieneRule,
  hygieneRuleKey,
  hygieneSpec,
  type HygieneSettings
} from '@/features/audiences/hygiene'
import { logger } from '@/lib/logger'
import {
  KlaviyoError,
  type KlaviyoClient
} from '@/lib/providers/klaviyo/client'
import {
  hygieneFingerprint,
  hygieneSegmentDefinition,
  hygieneSegmentName,
  sameDefinition
} from '@/lib/providers/klaviyo/hygiene-segment'
import {
  createHygieneSegment,
  findSegmentsByName,
  readAccountId,
  readHygieneMetrics,
  readSegment
} from '@/lib/providers/klaviyo/segments'

/**
 * PICK-101 (list hygiene): before the live pusher makes a draft campaign
 * it makes sure the store's exclusion segment is in its Klaviyo ("List
 * hygiene · 180 days · v1 · 3fa9c2d1": people with no clicks, opens, site
 * visits or orders), and the campaign leaves it out. It runs inside the
 * push, under the email build's push lease (the job this remote work
 * belongs to), behind the same switches: `KLAVIYO_MODE` and
 * `KLAVIYO_DRAFT_PUSH=live`, and the write lock (KLV-LOCK-001), which the
 * client checks again on its own.
 *
 * **It never holds an email back, and when in doubt it keeps people.** Any
 * failure (Klaviyo unwell or refusing, a key without `segments:write`, an
 * incomplete metrics read, an account without email or order metrics, a
 * segment with our name but another definition) gives a draft that leaves
 * nobody out, with the reason stored and tried again later (an hour for
 * Klaviyo being unwell, a day otherwise). Only the push's own time running
 * out (`rethrow`) and another push making the segment right now (`wait`)
 * stop the push, and both only for a moment.
 *
 * Made once per rule, account and metrics, then reused: the row keeps the
 * Klaviyo account and a fingerprint of the metrics the definition reads;
 * a reconnect to another account or a changed set of metrics makes a new
 * segment, and drafts switch to it. A stored segment is checked to still
 * be there before every use. A segment found by its name is adopted only
 * when its definition is exactly what the rule builds. One the owner
 * deleted in Klaviyo is not made again until he asks on Audiences.
 */

export type HygieneState =
  'creating' | 'ready' | 'no_data' | 'failed' | 'deleted'

export type StoredHygieneSegment = {
  state: HygieneState
  segmentId: string | null
  reason: string | null
  accountId: string | null
  fingerprint: string | null
  createStartedAt: string | null
  profileCount: number | null
  countedAt: string | null
  /** When the row was last written. */
  updatedAt: string
}

/** What a step sets; the database sets `createStartedAt` itself. */
export type HygieneStep = Partial<
  Pick<
    StoredHygieneSegment,
    | 'state'
    | 'segmentId'
    | 'reason'
    | 'accountId'
    | 'fingerprint'
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
   * push is making the segment right now (or holds its claim).
   */
  save(ref: HygieneRef, ruleKey: string, step: HygieneStep): Promise<void>
}

/** Another push is making the segment: wait a moment, never make a second one. */
export class HygieneBusy extends Error {}

/** A reason Klaviyo may soon get over is tried again after this long. */
export const hygieneShortRetryMs = 3600_000
/** Any other reason is tried again after this long. */
export const hygieneRetryMs = 24 * 3600_000
/** A create whose answer was lost may take this long to show. */
export const hygieneShowMs = 120_000

const shortReasons = new Set([
  'klaviyo_unavailable',
  'rate_limited',
  'metrics_unread',
  'error'
])
const retryAfter = (reason: string | null) =>
  reason && shortReasons.has(reason) ? hygieneShortRetryMs : hygieneRetryMs

/** What the campaign leaves out, or `wait` (come back; never make twice). */
export type Exclusion = { excluded: string[] } | 'wait'

const none: Exclusion = { excluded: [] }

function reasonOf(error: unknown) {
  if (!(error instanceof KlaviyoError)) return 'error'
  switch (error.kind) {
    case 'missing_scope':
      return 'missing_scope'
    case 'bad_key':
      return 'bad_key'
    case 'rejected':
      return 'refused'
    case 'rate_limited':
      return 'rate_limited'
    case 'write_locked':
      return 'write_locked'
    default:
      return 'klaviyo_unavailable'
  }
}

export async function hygieneExclusion(
  client: KlaviyoClient,
  ref: HygieneRef,
  store: HygieneStore,
  options: {
    now?: () => Date
    /** Errors that must stop the push (its time ran out): thrown on. */
    rethrow?: (error: unknown) => boolean
  } = {}
): Promise<Exclusion> {
  const now = options.now ?? (() => new Date())
  let key: string | null = null
  let stored: StoredHygieneSegment | null = null
  try {
    const rule = hygieneRule(await store.settings(ref.tenantId))
    if (!rule.enabled) return none
    key = hygieneRuleKey(rule)
    stored = await store.load(ref.tenantId, key)
    return await ensure(client, ref, store, key, stored, rule, now)
  } catch (error) {
    if (options.rethrow?.(error)) throw error
    if (error instanceof HygieneBusy) return 'wait'
    const reason = reasonOf(error)
    logger.warn('List hygiene: the draft leaves nobody out this time', {
      build: ref.build,
      reason,
      status: error instanceof KlaviyoError ? (error.details.status ?? 0) : 0
    })
    // A ready segment stays as it is (the next push checks it again).
    if (key && stored?.state !== 'ready')
      try {
        await store.save(ref, key, { state: 'failed', reason })
      } catch {
        // The draft still goes in; the reason is only a note.
      }
    return none
  }
}

async function ensure(
  client: KlaviyoClient,
  ref: HygieneRef,
  store: HygieneStore,
  key: string,
  stored: StoredHygieneSegment | null,
  rule: ReturnType<typeof hygieneRule>,
  now: () => Date
): Promise<Exclusion> {
  const ago = (iso: string | null) =>
    iso ? now().getTime() - Date.parse(iso) : Number.POSITIVE_INFINITY
  // The owner deleted it in Klaviyo: made again only when he asks.
  if (stored?.state === 'deleted') return none
  if (
    (stored?.state === 'no_data' || stored?.state === 'failed') &&
    ago(stored.updatedAt) < retryAfter(stored.reason)
  )
    return none

  const accountId = await readAccountId(client)
  const metrics = await readHygieneMetrics(client)
  const planned = hygieneSpec(rule, metrics)
  if ('none' in planned) {
    await store.save(ref, key, {
      state: 'no_data',
      reason: planned.none,
      accountId,
      fingerprint: null,
      segmentId: null
    })
    // A metric we no longer see (or an unread page) is doubt: keep people.
    return none
  }
  const { spec } = planned
  const fingerprint = hygieneFingerprint(spec)
  const built = hygieneSegmentDefinition(spec)!
  const counted = (n: number | null) => ({
    profileCount: n,
    countedAt: n === null ? null : now().toISOString()
  })

  // Ours, for this account and these metrics: checked to still be there.
  if (
    stored?.state === 'ready' &&
    stored.segmentId &&
    stored.accountId === accountId &&
    stored.fingerprint === fingerprint
  ) {
    const seg = await readSegment(client, stored.segmentId)
    if (seg === 'gone') {
      await store.save(ref, key, {
        state: 'deleted',
        reason: 'segment_deleted',
        segmentId: null
      })
      return none
    }
    await store.save(ref, key, counted(seg.profileCount))
    return { excluded: [stored.segmentId] }
  }

  // Made before under our name (a lost answer or a lost save): adopted
  // only when it is exactly what the rule builds.
  const found = await findSegmentsByName(client, hygieneSegmentName(spec))
  for (const id of found) {
    const seg = await readSegment(client, id)
    if (seg !== 'gone' && sameDefinition(seg.definition, built)) {
      await store.save(ref, key, {
        state: 'ready',
        segmentId: id,
        reason: null,
        accountId,
        fingerprint,
        ...counted(seg.profileCount)
      })
      return { excluded: [id] }
    }
  }
  if (found.length) {
    await store.save(ref, key, {
      state: 'failed',
      reason: 'name_taken',
      accountId,
      fingerprint,
      segmentId: null
    })
    return none
  }
  // Our own create may not show yet: wait for it rather than make two.
  if (
    stored?.state === 'creating' &&
    stored.accountId === accountId &&
    stored.fingerprint === fingerprint &&
    ago(stored.createStartedAt) < hygieneShowMs
  )
    return 'wait'
  await store.save(ref, key, {
    state: 'creating',
    accountId,
    fingerprint,
    segmentId: null
  })
  const id = await createHygieneSegment(client, spec)
  await store.save(ref, key, { state: 'ready', segmentId: id, reason: null })
  return { excluded: [id] }
}

/**
 * The draft could not be made with the exclusion (Klaviyo refused the
 * excluded segment): noted, and tried again a day later.
 */
export async function exclusionRefused(ref: HygieneRef, store: HygieneStore) {
  try {
    const rule = hygieneRule(await store.settings(ref.tenantId))
    await store.save(ref, hygieneRuleKey(rule), {
      state: 'failed',
      reason: 'draft_refused',
      segmentId: null
    })
  } catch {
    // Only a note.
  }
}
