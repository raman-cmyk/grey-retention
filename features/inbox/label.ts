import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { isBlockType } from '@/features/blocks/catalog'
import { InboundTransportError } from '@/lib/providers/inbound-capture'
import { emailFacts, factsVersion } from './facts'
import type { SectionLabel, SectionLabeller } from './labeller'
import type { EmailSection } from './sections'

type Db = SupabaseClient<Database>
type Lease = { id: string; lease_token: string; subject_key: string }

export type LabelRun = { emails: number; sections: number; retried: number }

/** A crop larger than this is not sent to the labeller. */
const maxCropBytes = 1_500_000

/**
 * What a labeller answered, made safe to store: an unknown block type is
 * 'unsure' (with no confidence), the confidence is 0..1 with two decimals,
 * the source is 'sample' or 'gemini' (a person's label is kept apart), and
 * the model is a short name or nothing.
 */
export function checkedLabel(answer: unknown): SectionLabel {
  const a = (answer ?? {}) as Partial<Record<keyof SectionLabel, unknown>>
  const known = isBlockType(a.type) || a.type === 'unsure'
  const c = Number(a.confidence)
  return {
    type: known ? (a.type as SectionLabel['type']) : 'unsure',
    confidence:
      known && Number.isFinite(c)
        ? Math.round(Math.min(1, Math.max(0, c)) * 100) / 100
        : 0,
    source: a.source === 'gemini' ? 'gemini' : 'sample',
    model:
      typeof a.model === 'string' && a.model.trim()
        ? a.model.trim().slice(0, 100)
        : null
  }
}

/** The section's crop for a labeller that looks at pictures, if there is one. */
async function cropOf(db: Db, path: string | null) {
  if (!path) return undefined
  const { data, error } = await db.storage.from('inbox-assets').download(path)
  if (error || !data || data.size > maxCropBytes) return undefined
  return {
    mediaType: 'image/jpeg',
    base64: Buffer.from(await data.arrayBuffer()).toString('base64')
  }
}

/**
 * The labelling part of the sweep (INB-003): takes `inbox.label` jobs until
 * `deadline`. For each email it labels every section with one of the 20
 * block types, works out the email's facts and records both once (the
 * database refuses to label an email twice for the same version).
 */
export async function labelInboxEmails(
  db: Db,
  labeller: SectionLabeller,
  deadline: number
): Promise<LabelRun> {
  const run: LabelRun = { emails: 0, sections: 0, retried: 0 }
  while (Date.now() < deadline) {
    const claimed = await db.rpc('claim_platform_job', {
      kinds: ['inbox.label']
    })
    if (claimed.error) throw claimed.error
    const job = (claimed.data as unknown as Lease[] | null)?.[0]
    if (!job) break
    const lease = { job: job.id, lease: job.lease_token }
    try {
      const [message, rows] = await Promise.all([
        db
          .from('inbox_messages')
          .select('id,subject,received_at,preheader,text_ratio')
          .eq('id', job.subject_key)
          .single(),
        db
          .from('email_sections')
          .select(
            'id,ordinal,html,text,kind,words,images,wide_images,links,image_path,owner_block_type'
          )
          .eq('inbox_message_id', job.subject_key)
          .order('ordinal')
      ])
      if (message.error || !message.data || rows.error)
        throw new InboundTransportError('protocol', 'inbox_message_missing')
      const sections: EmailSection[] = rows.data.map((r) => ({
        ordinal: r.ordinal,
        html: r.html,
        text: r.text,
        kind: r.kind as EmailSection['kind'],
        words: r.words,
        images: r.images,
        wideImages: r.wide_images,
        links: (r.links ?? []) as EmailSection['links']
      }))
      // Every section gets a machine label; a person's own label (kept
      // apart in the database) wins in the email's block sequence.
      const labels: (SectionLabel & { ordinal: number })[] = []
      const sequence: string[] = []
      for (const [i, section] of sections.entries()) {
        const row = rows.data[i]!
        const label = checkedLabel(
          await labeller.label({
            sectionId: row.id,
            section,
            position: { ordinal: section.ordinal, of: sections.length },
            image: labeller.wantsImage
              ? await cropOf(db, row.image_path)
              : undefined
          })
        )
        labels.push({ ordinal: section.ordinal, ...label })
        sequence.push(row.owner_block_type ?? label.type)
      }
      const facts = emailFacts({
        subject: message.data.subject,
        preview: message.data.preheader,
        sections,
        sentAt: new Date(message.data.received_at).toISOString(),
        blockSequence: sequence,
        textRatio:
          message.data.text_ratio === null
            ? null
            : Number(message.data.text_ratio)
      })
      const recorded = await db.rpc('record_inbox_labels', {
        ...lease,
        labels,
        facts,
        version: factsVersion
      })
      if (recorded.error) throw recorded.error
      const finished = await db.rpc('finish_platform_job', {
        ...lease,
        outcome: (recorded.data ?? {}) as Json
      })
      if (finished.error) throw finished.error
      run.emails++
      run.sections += sections.length
    } catch (error) {
      run.retried++
      const failure =
        error instanceof InboundTransportError
          ? error
          : new InboundTransportError(
              'internal',
              (error as { code?: string }).code === 'PT409'
                ? 'lease_lost'
                : 'label_worker_error'
            )
      const failed = await db.rpc('fail_platform_job', {
        ...lease,
        failure: failure.kind === 'too_large' ? 'protocol' : failure.kind,
        error_code: failure.code
      })
      if (failed.error)
        logger.warn('Inbox label job failure not recorded', {
          code: failed.error.code ?? 'unknown',
          failure: failure.code
        })
    }
  }
  return run
}
