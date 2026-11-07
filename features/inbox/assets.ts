import 'server-only'
import PostalMime from 'postal-mime'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { mimeLimits } from '@/features/email-import/parse'
import { InboundTransportError } from '@/lib/providers/inbound-capture'
import type { ImageFailure, ImageFetcher } from '@/lib/providers/image-fetch'
import { sha256 } from './addresses'
import { dataUri, imageRefs, sniffImage, type ImageRef } from './images'

type Db = SupabaseClient<Database>

export const assetLimits = {
  /** One image. */
  maxImageBytes: 5 * 1024 * 1024,
  /** All images of one email together. */
  maxEmailBytes: 25 * 1024 * 1024,
  /** One download, redirects included. */
  imageTimeoutMs: 5_000,
  /** Downloads at the same time. */
  parallel: 6
}

type Lease = {
  id: string
  lease_token: string
  subject_key: string
  attempt: number
}

/** The attempts a platform job gets (the database's limit). */
const lastAttempt = 4

export type ImageRecord = {
  ordinal: number
  source: ImageRef['source']
  sourceRef: string
  state: 'stored' | 'failed'
  failure?: ImageFailure
  path?: string
  sha256?: string
  bytes?: number
  contentType?: string
}

export type AssetsRun = {
  emails: number
  stored: number
  failed: number
  /** Emails that could not be finished this time (they are retried). */
  retried: number
}

/** Runs `work` over the items with at most `limit` at a time, in order. */
async function inParallel<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>
) {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await work(items[i]!)
      }
    })
  )
  return results
}

async function download(db: Db, bucket: string, path: string) {
  const { data, error } = await db.storage.from(bucket).download(path)
  if (error || !data)
    throw new InboundTransportError('unavailable', 'stored_copy_unreadable')
  return new Uint8Array(await data.arrayBuffer())
}

/** The email's own parts by Content-ID (for cid: images). */
async function cidParts(raw: Uint8Array) {
  const parts = new Map<string, Uint8Array>()
  try {
    const email = await PostalMime.parse(raw, {
      ...mimeLimits,
      attachmentEncoding: 'arraybuffer'
    })
    for (const a of email.attachments) {
      const id = a.contentId?.replace(/^<|>$/g, '').toLowerCase()
      if (id && a.content instanceof ArrayBuffer)
        parts.set(id, new Uint8Array(a.content))
    }
  } catch {
    // An unreadable email simply has no parts; its cid: images fail.
  }
  return parts
}

/**
 * Keeps every image of one email: downloads (or reads from the email
 * itself), checks each by its bytes, stores it once by content under
 * img/<sha256>.<ext>. Throws a `timeout` when the deadline comes first, so
 * nothing half-done is recorded and the job is tried again later; on the
 * job's last attempt (`final`) what is left is recorded as `timeout`
 * instead, so the email still gets its screenshot.
 */
export async function keepImages(
  db: Db,
  html: string,
  raw: () => Promise<Uint8Array>,
  fetcher: ImageFetcher,
  deadline: number,
  limits = assetLimits,
  final = false
): Promise<ImageRecord[]> {
  const refs = imageRefs(html)
  const parts = refs.some((r) => r.source === 'cid')
    ? await cidParts(await raw())
    : new Map<string, Uint8Array>()
  let used = 0
  let late = false
  const records = await inParallel(
    refs,
    limits.parallel,
    async (ref): Promise<ImageRecord> => {
      const base = {
        ordinal: ref.ordinal,
        source: ref.source,
        // A data: image can be huge; its reference is only a label here.
        sourceRef: ref.ref.slice(0, 2000)
      }
      const failed = (failure: ImageFailure): ImageRecord => ({
        ...base,
        state: 'failed',
        failure
      })
      const left = deadline - Date.now()
      if (left <= 0) {
        late = true
        return failed('timeout')
      }
      if (used >= limits.maxEmailBytes) return failed('limit')
      let bytes: Uint8Array | null = null
      if (ref.source === 'cid')
        bytes = parts.get(ref.target.toLowerCase()) ?? null
      else if (ref.source === 'inline') bytes = dataUri(ref.target)
      else {
        const got = await fetcher.fetch(ref.target, {
          maxBytes: limits.maxImageBytes,
          timeoutMs: Math.min(limits.imageTimeoutMs, left)
        })
        if (!got.ok) {
          // Running out of the sweep's time is not the image's fault.
          if (got.failure === 'timeout' && Date.now() >= deadline) late = true
          return failed(got.failure)
        }
        bytes = got.bytes
      }
      if (!bytes?.byteLength) return failed('broken')
      if (bytes.byteLength > limits.maxImageBytes) return failed('too_large')
      const type = sniffImage(bytes)
      if (!type) return failed('not_image')
      if (used + bytes.byteLength > limits.maxEmailBytes) return failed('limit')
      used += bytes.byteLength
      const hash = sha256(bytes)
      const path = `img/${hash}.${type.ext}`
      const { error } = await db.storage
        .from('inbox-assets')
        .upload(path, bytes, { contentType: type.contentType, upsert: false })
      const status = String(
        (error as { statusCode?: string | number } | null)?.statusCode ?? ''
      )
      if (error && !/exists|duplicate/i.test(error.message) && status !== '409')
        throw new InboundTransportError('unavailable', 'storage_upload_failed')
      return {
        ...base,
        state: 'stored',
        path,
        sha256: hash,
        bytes: bytes.byteLength,
        contentType: type.contentType
      }
    }
  )
  if (late && !final)
    throw new InboundTransportError('timeout', 'assets_out_of_time')
  return records
}

/**
 * The image part of the sweep (INB-002): takes `inbox.assets` jobs one at
 * a time until `deadline`, and for each email keeps every image, records
 * the result once and queues its screenshot. Sample emails use the sample
 * fetcher; real ones the live one.
 */
export async function keepInboxImages(
  db: Db,
  fetchers: { real: ImageFetcher; sample: ImageFetcher },
  deadline: number
): Promise<AssetsRun> {
  const run: AssetsRun = { emails: 0, stored: 0, failed: 0, retried: 0 }
  // An email is started only when one slow image still fits in the time.
  while (deadline - Date.now() > assetLimits.imageTimeoutMs + 2_000) {
    const claimed = await db.rpc('claim_platform_job', {
      kinds: ['inbox.assets']
    })
    if (claimed.error) throw claimed.error
    const job = (claimed.data as unknown as Lease[] | null)?.[0]
    if (!job) break
    const lease = { job: job.id, lease: job.lease_token }
    try {
      const message = await db
        .from('inbox_messages')
        .select('id,html_path,raw_path,synthetic')
        .eq('id', job.subject_key)
        .single()
      if (message.error || !message.data?.html_path || !message.data.raw_path)
        throw new InboundTransportError('protocol', 'inbox_message_missing')
      const { html_path, raw_path, synthetic } = message.data
      const html = new TextDecoder().decode(
        await download(db, 'inbox-raw', html_path)
      )
      const images = await keepImages(
        db,
        html,
        () => download(db, 'inbox-raw', raw_path),
        synthetic ? fetchers.sample : fetchers.real,
        deadline,
        assetLimits,
        job.attempt >= lastAttempt
      )
      const recorded = await db.rpc('record_inbox_images', {
        ...lease,
        images
      })
      if (recorded.error) throw recorded.error
      const finished = await db.rpc('finish_platform_job', {
        ...lease,
        outcome: recorded.data as Record<string, number>
      })
      if (finished.error) throw finished.error
      run.emails++
      run.stored += images.filter((i) => i.state === 'stored').length
      run.failed += images.filter((i) => i.state === 'failed').length
    } catch (error) {
      run.retried++
      const failure =
        error instanceof InboundTransportError
          ? error
          : new InboundTransportError(
              'internal',
              (error as { code?: string }).code !== 'PT409'
                ? 'assets_worker_error'
                : /stored copy missing/i.test(
                      (error as { message?: string }).message ?? ''
                    )
                  ? 'stored_copy_missing'
                  : 'lease_lost'
            )
      const failed = await db.rpc('fail_platform_job', {
        ...lease,
        failure: failure.kind === 'too_large' ? 'protocol' : failure.kind,
        error_code: failure.code
      })
      if (failed.error)
        logger.warn('Inbox image job failure not recorded', {
          code: failed.error.code ?? 'unknown',
          failure: failure.code
        })
      // One email that cannot be finished never holds up the others, but
      // running out of time ends this part of the sweep.
      if (failure.kind === 'timeout') break
    }
  }
  return run
}
