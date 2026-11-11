import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { blockTypes, type BlockType } from '@/features/blocks/catalog'
import { makeVariant, type Made } from '@/features/intelligence/maker'
import { TagError, waitFor, type Ask } from '@/features/intelligence/passes'
import { skeletonOf } from '@/features/intelligence/skeleton'
import {
  layouts,
  purposes,
  styles as styleList,
  type Layout,
  type Purpose,
  type Style
} from '@/features/intelligence/taxonomy'
import {
  fingerprintOf,
  type VariantSpec
} from '@/features/intelligence/variants'
import type { AiImage } from '@/lib/providers/contracts'
import { InboundTransportError } from '@/lib/providers/inbound-capture'

type Db = SupabaseClient<Database>
type Lease = { id: string; lease_token: string; subject_key: string }

export type VariantRun = {
  emails: number
  /** New variants added to the library. */
  made: number
  /** Sections that added evidence to a variant already there. */
  matched: number
  /** Sections left out: no structure, or none that can be drawn. */
  dropped: number
  retried: number
  /** Jobs put back without using a try (time up, or the budget spent). */
  deferred: number
}

/** New structures made at once (one Variant maker call each). */
export const variantBatch = 6
/** Time a live batch is given; no batch starts with less left. */
export const liveVariantMs = 6_000
/** A picture larger than this is not sent to the Variant maker. */
const maxPictureBytes = 1_500_000

type SectionRow = {
  id: string
  html: string
  image_path: string | null
  block_type: string | null
  owner_block_type: string | null
  layout: string | null
  purpose: string | null
  styles: string[] | null
  tag_state: string | null
  variant_state: string | null
}

/** A section to place in the library, with what the database stores. */
type Todo = {
  row: SectionRow
  family: BlockType
  layout: Layout
  purpose: Purpose
  styles: Style[]
  skeleton: VariantSpec | null
  /** The fingerprint of the structure read from the HTML. */
  key: string | null
}

const isFamily = (v: string | null): v is BlockType =>
  !!v && (blockTypes as readonly string[]).includes(v)

/** A tagged section not yet placed, with its tags read back strictly. */
function todoOf(row: SectionRow): Todo | null {
  const family = row.owner_block_type ?? row.block_type
  if (row.tag_state !== 'tagged' || row.variant_state || !isFamily(family))
    return null
  const layout = row.layout as Layout
  const purpose = row.purpose as Purpose
  if (!layouts.includes(layout) || !purposes.includes(purpose)) return null
  const skeleton = skeletonOf(row.html)
  return {
    row,
    family,
    layout,
    purpose,
    styles: (row.styles ?? []).filter((s): s is Style =>
      (styleList as readonly string[]).includes(s)
    ),
    skeleton,
    key: skeleton ? fingerprintOf(family, skeleton) : null
  }
}

async function pictureOf(
  db: Db,
  path: string | null
): Promise<AiImage | undefined> {
  if (!path) return undefined
  const { data, error } = await db.storage.from('inbox-assets').download(path)
  if (error || !data || data.size > maxPictureBytes) return undefined
  return {
    mediaType: 'image/jpeg',
    base64: Buffer.from(await data.arrayBuffer()).toString('base64')
  }
}

/** One section's outcome as `record_block_variants` takes it. */
function entryOf(todo: Todo, made: Made) {
  if (made.state === 'dropped')
    return {
      section_id: todo.row.id,
      state: made.reason,
      skeleton_fingerprint: todo.key
    }
  return {
    section_id: todo.row.id,
    state: 'made',
    skeleton_fingerprint: todo.key,
    variant: {
      fingerprint: made.fingerprint,
      pass: made.pass,
      model: made.model,
      styles: todo.styles,
      spec: made.spec
    }
  }
}

/**
 * The library part of the sweep (CI-002): takes `inbox.variant` jobs until
 * `deadline`. For each tagged section of the email, its structure is read
 * from its HTML; when that structure is already in the library (by its
 * fingerprint, or because the same structure was seen before), the
 * section adds evidence to that variant without any AI. Only a new
 * structure goes to the Variant maker, a batch at a time, each batch saved
 * at once. A section with no structure, or none that can be drawn, is left
 * out and logged (D16). When time runs short, the platform's AI budget is
 * spent or the provider is rate limiting, the job is put back without
 * using up a try.
 */
export async function makeInboxVariants(
  db: Db,
  ask: Ask,
  deadline: number,
  options: { pictures?: boolean; batchMs?: number } = {}
): Promise<VariantRun> {
  const batchMs = options.batchMs ?? 0
  const run: VariantRun = {
    emails: 0,
    made: 0,
    matched: 0,
    dropped: 0,
    retried: 0,
    deferred: 0
  }
  while (Date.now() + batchMs < deadline) {
    const claimed = await db.rpc('claim_platform_job', {
      kinds: ['inbox.variant']
    })
    if (claimed.error) throw claimed.error
    const job = (claimed.data as unknown as Lease[] | null)?.[0]
    if (!job) break
    const lease = { job: job.id, lease: job.lease_token }
    const putBack = async (delaySeconds: number, reason: string) => {
      const deferred = await db.rpc('defer_platform_job', {
        ...lease,
        delay_seconds: delaySeconds,
        reason
      })
      if (deferred.error) throw deferred.error
      run.deferred++
    }
    const record = async (entries: object[]) => {
      if (!entries.length) return
      const recorded = await db.rpc('record_block_variants', {
        ...lease,
        sections: entries as unknown as Json
      })
      if (recorded.error) throw recorded.error
      const counts = (recorded.data ?? {}) as {
        made?: number
        matched?: number
        dropped?: number
      }
      run.made += counts.made ?? 0
      run.matched += counts.matched ?? 0
      run.dropped += counts.dropped ?? 0
    }
    try {
      const [message, rows] = await Promise.all([
        db
          .from('inbox_messages')
          .select('id,industry')
          .eq('id', job.subject_key)
          .single(),
        db
          .from('email_sections')
          .select(
            'id,html,image_path,block_type,owner_block_type,layout,purpose,styles,tag_state,variant_state'
          )
          .eq('inbox_message_id', job.subject_key)
          .order('ordinal')
      ])
      if (message.error || !message.data || rows.error)
        throw new InboundTransportError('protocol', 'inbox_message_missing')
      const todo = ((rows.data ?? []) as unknown as SectionRow[])
        .map(todoOf)
        .filter((t): t is Todo => t !== null)
      // Structures already in the library, or already found unusable: no
      // AI call.
      const keys = [...new Set(todo.flatMap((t) => (t.key ? [t.key] : [])))]
      const known = new Map<string, string | null>()
      if (keys.length) {
        const found = await db.rpc('find_block_variants', { keys })
        if (found.error) throw found.error
        for (const r of found.data ?? []) known.set(r.fingerprint, r.variant_id)
      }
      const first: object[] = []
      const fresh: Todo[] = []
      for (const t of todo) {
        const variant = t.key ? known.get(t.key) : undefined
        if (!t.skeleton || !t.key) {
          first.push({ section_id: t.row.id, state: 'no_structure' })
          logger.info('Section left out of the block library', {
            reason: 'no_structure'
          })
        } else if (variant === null)
          first.push({
            section_id: t.row.id,
            state: 'unusable',
            skeleton_fingerprint: t.key
          })
        else if (variant)
          first.push({
            section_id: t.row.id,
            state: 'matched',
            variant_id: variant,
            skeleton_fingerprint: t.key
          })
        else fresh.push(t)
      }
      await record(first)
      // One Variant maker call per new structure, even when the email
      // repeats it; the repeats add evidence to what it made.
      const groups = new Map<string, Todo[]>()
      for (const t of fresh)
        groups.set(t.key!, [...(groups.get(t.key!) ?? []), t])
      const pending = [...groups.values()]
      let cutShort = false
      for (let i = 0; i < pending.length; i += variantBatch) {
        // A batch started late would outlive the run; the job comes back.
        if (i > 0 && Date.now() + batchMs > deadline) {
          cutShort = true
          break
        }
        const batch = pending.slice(i, i + variantBatch)
        const made = await Promise.all(
          batch.map(async ([lead]) =>
            makeVariant(
              {
                sectionId: lead!.row.id,
                family: lead!.family,
                layout: lead!.layout,
                purpose: lead!.purpose,
                styles: lead!.styles,
                skeleton: lead!.skeleton!,
                image: options.pictures
                  ? await pictureOf(db, lead!.row.image_path)
                  : undefined
              },
              ask,
              message.data.industry
            )
          )
        )
        const entries = batch.flatMap((group, n) =>
          group.map((t) => entryOf(t, made[n]!))
        )
        for (const m of made)
          if (m.state === 'dropped')
            logger.info('Section left out of the block library', {
              reason: m.reason
            })
        await record(entries)
      }
      if (cutShort) {
        await putBack(0, 'variants_continue')
        break
      }
      const finished = await db.rpc('finish_platform_job', {
        ...lease,
        outcome: { sections: todo.length }
      })
      if (finished.error) throw finished.error
      run.emails++
    } catch (error) {
      // The platform's budget is spent, or the provider is rate limiting:
      // this job and every other one would be refused, so it waits without
      // using a try and the run stops.
      const wait = waitFor(error)
      if (wait) {
        await putBack(wait.delaySeconds, wait.reason)
        break
      }
      run.retried++
      const failure =
        error instanceof InboundTransportError
          ? error
          : error instanceof TagError
            ? new InboundTransportError('unavailable', `ai_${error.code}`)
            : new InboundTransportError(
                'internal',
                (error as { code?: string }).code === 'PT409'
                  ? 'lease_lost'
                  : 'variant_worker_error'
              )
      const failed = await db.rpc('fail_platform_job', {
        ...lease,
        failure: failure.kind === 'too_large' ? 'protocol' : failure.kind,
        error_code: failure.code
      })
      if (failed.error)
        logger.warn('Inbox variant job failure not recorded', {
          code: failed.error.code ?? 'unknown',
          failure: failure.code
        })
    }
  }
  return run
}
