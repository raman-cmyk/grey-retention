import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { classifyEmail, industryOf } from '@/features/intelligence/classifier'
import { TagError, waitFor, type Ask } from '@/features/intelligence/passes'
import { tagSection } from '@/features/intelligence/tagger'
import {
  sectionTagsSchema,
  tagVersion,
  type EmailLabels,
  type SectionTags,
  type Tagged
} from '@/features/intelligence/taxonomy'
import type { AiImage } from '@/lib/providers/contracts'
import { InboundTransportError } from '@/lib/providers/inbound-capture'
import { emailFacts, factsVersion } from './facts'
import type { EmailSection } from './sections'

type Db = SupabaseClient<Database>
type Lease = { id: string; lease_token: string; subject_key: string }

export type LabelRun = {
  emails: number
  sections: number
  untagged: number
  retried: number
  /** Jobs put back without using a try (time up, or the budget spent). */
  deferred: number
}

/** A picture larger than this is not sent to the agents. */
const maxPictureBytes = 1_500_000
/** Sections tagged at once (each may take two calls). */
export const tagBatch = 6
/** Time a live batch of calls is given; no batch starts with less left. */
export const liveBatchMs = 8_000

/** A stored picture (a section crop or the screenshot), if small enough. */
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

/** One section's outcome as the database stores it. */
function storedTags(ordinal: number, t: Tagged<SectionTags>) {
  return t.state === 'tagged'
    ? {
        ordinal,
        state: 'tagged',
        family: t.labels.family,
        layout: t.labels.layout,
        purpose: t.labels.purpose,
        styles: t.labels.styles,
        confidence: Math.round(t.labels.confidence * 100) / 100,
        pass: t.pass,
        model: t.model
      }
    : { ordinal, state: 'untagged', pass: t.pass, model: t.model }
}

/** The email's outcome as the database stores it. */
function storedLabels(t: Tagged<EmailLabels>) {
  return t.state === 'tagged'
    ? {
        state: 'tagged',
        industry: t.labels.industry,
        email_type: t.labels.emailType,
        offer_type: t.labels.offerType,
        season: t.labels.season,
        angle: t.labels.angle,
        brand_size: t.labels.brandSize,
        confidence: Math.round(t.labels.confidence * 100) / 100,
        pass: t.pass,
        model: t.model
      }
    : { state: 'untagged', pass: t.pass, model: t.model }
}

type SectionRow = {
  id: string
  ordinal: number
  html: string
  text: string
  kind: string
  words: number
  images: number
  wide_images: number
  links: unknown
  image_path: string | null
  owner_block_type: string | null
  block_type: string | null
  layout: string | null
  purpose: string | null
  styles: string[] | null
  confidence: number | null
  tag_state: string | null
  tag_version: string | null
}

/** A section's family as already stored at this tag version, if any. */
function storedFamily(row: SectionRow): string | null {
  if (row.tag_version !== tagVersion) return null
  if (row.tag_state === 'untagged') return 'unsure'
  const tags = sectionTagsSchema.safeParse({
    family: row.block_type,
    layout: row.layout,
    purpose: row.purpose,
    styles: row.styles ?? [],
    confidence: Number(row.confidence)
  })
  return row.tag_state === 'tagged' && tags.success ? tags.data.family : null
}

/**
 * The tagging part of the sweep (CI-001): takes `inbox.label` jobs until
 * `deadline`. For each email the Section tagger tags the sections not yet
 * tagged at this version, a batch at a time, and each batch is stored at
 * once, so a retry or a run cut short pays only for what is left. Then the
 * facts are worked out and the Email classifier labels the email, both
 * recorded once per version. An email already tagged is finished without a
 * call. When time runs short, the platform's AI budget is spent or the
 * provider is rate limiting, the job is put back without using up a try
 * (D16: it simply runs later).
 * `pictures` sends each section's crop and the screenshot along; `batchMs`
 * is the time a batch needs (none for the sample rules).
 */
export async function labelInboxEmails(
  db: Db,
  ask: Ask,
  deadline: number,
  options: { pictures?: boolean; batchMs?: number } = {}
): Promise<LabelRun> {
  const batchMs = options.batchMs ?? 0
  const run: LabelRun = {
    emails: 0,
    sections: 0,
    untagged: 0,
    retried: 0,
    deferred: 0
  }
  // A job is taken only with time for at least one batch.
  while (Date.now() + batchMs < deadline) {
    const claimed = await db.rpc('claim_platform_job', {
      kinds: ['inbox.label']
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
      // A spent budget or a rate limit is worth seeing in the logs (a daily
      // quota would keep putting jobs back).
      if (reason.startsWith('ai_'))
        logger.warn('Inbox label job put back', { reason, delaySeconds })
    }
    try {
      const [message, rows] = await Promise.all([
        db
          .from('inbox_messages')
          .select(
            'id,subject,received_at,preheader,text_ratio,screenshot_path,capture_id,labelled_at,extraction_version'
          )
          .eq('id', job.subject_key)
          .single(),
        db
          .from('email_sections')
          .select(
            'id,ordinal,html,text,kind,words,images,wide_images,links,image_path,owner_block_type,block_type,layout,purpose,styles,confidence,tag_state,tag_version'
          )
          .eq('inbox_message_id', job.subject_key)
          .order('ordinal')
      ])
      if (message.error || !message.data || rows.error)
        throw new InboundTransportError('protocol', 'inbox_message_missing')
      // Already tagged at this version (a re-delivered job): no call at all.
      if (
        message.data.labelled_at &&
        (message.data.extraction_version ?? 0) >= factsVersion
      ) {
        const finished = await db.rpc('finish_platform_job', {
          ...lease,
          outcome: { already: true }
        })
        if (finished.error) throw finished.error
        continue
      }
      const capture = message.data.capture_id
        ? await db
            .from('competitor_captures')
            .select('niche')
            .eq('id', message.data.capture_id)
            .maybeSingle()
        : null
      const niche = capture?.data?.niche ?? null
      const industry = industryOf(niche)
      const stored = (rows.data ?? []) as unknown as SectionRow[]
      const sections: EmailSection[] = stored.map((r) => ({
        ordinal: r.ordinal,
        html: r.html,
        text: r.text,
        kind: r.kind as EmailSection['kind'],
        words: r.words,
        images: r.images,
        wideImages: r.wide_images,
        links: (r.links ?? []) as EmailSection['links']
      }))
      const families = new Map<number, string>()
      for (const row of stored) {
        const family = storedFamily(row)
        if (family) families.set(row.ordinal, family)
      }
      const todo = stored.filter((r) => !families.has(r.ordinal))
      let cutShort = false
      for (let i = 0; i < todo.length; i += tagBatch) {
        // A batch started late would outlive the run; the job comes back.
        if (i > 0 && Date.now() + batchMs > deadline) {
          cutShort = true
          break
        }
        const batch = todo.slice(i, i + tagBatch)
        const settled = await Promise.allSettled(
          batch.map(async (row) => {
            const section = sections[stored.indexOf(row)]!
            return {
              row,
              result: await tagSection(
                {
                  sectionId: row.id,
                  section,
                  position: { ordinal: row.ordinal, of: sections.length },
                  subject: message.data.subject,
                  image: options.pictures
                    ? await pictureOf(db, row.image_path)
                    : undefined
                },
                ask,
                industry
              )
            }
          })
        )
        // What was answered is kept even when another call failed: the
        // retry pays only for the rest.
        const tagged = settled.flatMap((r) =>
          r.status === 'fulfilled' ? [r.value] : []
        )
        if (tagged.length) {
          const recorded = await db.rpc('record_section_tags', {
            ...lease,
            sections: tagged.map((t) =>
              storedTags(t.row.ordinal, t.result)
            ) as unknown as Json,
            tag_version: tagVersion
          })
          if (recorded.error) throw recorded.error
        }
        const failed = settled.find((r) => r.status === 'rejected')
        if (failed) throw failed.reason
        for (const { row, result } of tagged) {
          if (result.state === 'untagged') run.untagged++
          families.set(
            row.ordinal,
            result.state === 'tagged' ? result.labels.family : 'unsure'
          )
        }
        run.sections += batch.length
      }
      if (cutShort || Date.now() + batchMs > deadline) {
        await putBack(0, 'tagging_continues')
        break
      }
      // A person's own label (kept apart in the database) wins in the
      // email's block sequence.
      const sequence = stored.map(
        (r) => r.owner_block_type ?? families.get(r.ordinal) ?? 'unsure'
      )
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
      const labels = await classifyEmail(
        {
          messageId: message.data.id,
          subject: message.data.subject,
          preview: message.data.preheader,
          niche,
          facts,
          families: sequence,
          text: sections
            .map((s) => s.text)
            .join('\n')
            .slice(0, 4000),
          image: options.pictures
            ? await pictureOf(db, message.data.screenshot_path)
            : undefined
        },
        ask
      )
      const recorded = await db.rpc('record_inbox_tags', {
        ...lease,
        email: storedLabels(labels) as unknown as Json,
        facts: facts as unknown as Json,
        version: factsVersion
      })
      if (recorded.error) throw recorded.error
      const finished = await db.rpc('finish_platform_job', {
        ...lease,
        outcome: (recorded.data ?? {}) as Json
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
