import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import {
  InboundTransportError,
  type InboundCaptureTransport,
  type InboundSession
} from '@/lib/providers/inbound-capture'
import { aliasSlug, messageKey, senderDomain, sha256 } from './addresses'
import { maxMessageBytes, readInboxMessage } from './mime'
import { inboxSignal, type InboxSignal } from './signals'

type Db = SupabaseClient<Database>

export const inboxLimits = {
  /** Messages read per poll; the next poll continues from the cursor. */
  messagesPerPoll: 25,
  /**
   * No new message is started after this long. The step around the poll
   * also stops waiting after 15 seconds, so the sweep keeps its minute.
   */
  budgetMs: 8_000
}

/** Database refusals of one message's content (not of the whole poll). */
const contentRefusals = new Set(['22P05', '23514', '22001', '22021', '22P02'])

export type InboxRun =
  | { state: 'paused' | 'busy' }
  | {
      state: 'done'
      recorded: number
      duplicates: number
      unassigned: number
      skipped: number
      more: boolean
    }
  | { state: 'failed'; code: string }

type Lease = {
  id: string
  lease_token: string
  context: { uidValidity?: number | null; lastUid?: number }
}

const bucket = 'inbox-raw'

/** Uploads one stored copy; one that already exists counts as stored. */
async function store(
  db: Db,
  path: string,
  body: Uint8Array | string,
  contentType: string
) {
  const { error } = await db.storage
    .from(bucket)
    .upload(path, body, { contentType, upsert: false })
  const status = String(
    (error as { statusCode?: string | number } | null)?.statusCode ?? ''
  )
  if (error && !/exists|duplicate/i.test(error.message) && status !== '409')
    throw new InboundTransportError('unavailable', 'storage_upload_failed')
}

/**
 * One poll of the inbox (INB-001): opens the mailbox's poll job, reads up to
 * 25 new messages above the cursor, stores each raw copy (and its HTML) in
 * the private `inbox-raw` bucket, records it once with its brand, and moves
 * the cursor after every message so a crash never repeats or skips one.
 * Runs as the service role; nothing here is reachable from a browser.
 */
export async function pollInbox(
  db: Db,
  transport: InboundCaptureTransport,
  options: { now?: () => number; limits?: Partial<typeof inboxLimits> } = {}
): Promise<InboxRun> {
  const limits = { ...inboxLimits, ...options.limits }
  const now = options.now ?? Date.now
  const started = now()
  const queued = await db.rpc('enqueue_inbox_poll', {
    mailbox: transport.mailbox
  })
  if (queued.error) throw queued.error
  if (!queued.data) return { state: 'paused' }
  const claimed = await db.rpc('claim_platform_job', {
    kinds: ['inbox.poll'],
    subject: transport.mailbox
  })
  if (claimed.error) throw claimed.error
  const job = (claimed.data as unknown as Lease[] | null)?.[0]
  if (!job) return { state: 'busy' }
  const lease = { job: job.id, lease: job.lease_token }

  let session: InboundSession | null = null
  // Messages recorded and passed by the cursor; marked read at the end.
  const done: number[] = []
  const counts = { recorded: 0, duplicates: 0, unassigned: 0, skipped: 0 }
  try {
    session = await transport.open()
    const listing = await session.list(
      {
        uidValidity: job.context.uidValidity ?? null,
        lastUid: job.context.lastUid ?? 0
      },
      limits.messagesPerPoll
    )
    type Item = (typeof listing.messages)[number]
    const record = (item: Item, msg: Record<string, unknown>) =>
      db.rpc('record_inbox_message', {
        ...lease,
        msg: {
          ...msg,
          uid: item.uid,
          uidValidity: listing.uidValidity,
          transportId: item.transportId,
          receivedAt: item.internalDate,
          synthetic: transport.synthetic
        }
      })
    for (const item of listing.messages) {
      if (now() - started >= limits.budgetMs) break
      // Without its bytes an oversized message is keyed by the server's id.
      let msg: Record<string, unknown> = {
        kind: 'too_large',
        messageKey: sha256(
          item.transportId
            ? `${transport.mailbox}:id:${item.transportId}`
            : `${transport.mailbox}:${listing.uidValidity}:${item.uid}`
        ),
        rawBytes: Math.max(1, Math.min(item.size, 52_428_800))
      }
      let raw: Uint8Array | null = null
      let signal: InboxSignal | null = null
      if (item.size <= maxMessageBytes) {
        try {
          raw = await session.fetchRaw(item.uid, maxMessageBytes)
        } catch (error) {
          // The server reported a smaller size than it sent.
          if (
            !(error instanceof InboundTransportError) ||
            error.kind !== 'too_large'
          )
            throw error
        }
      }
      let stored: Record<string, unknown> | null = null
      if (raw) {
        const hash = sha256(raw)
        const parsed = await readInboxMessage(raw)
        const rawPath = `${transport.mailbox}/${hash}.eml`
        await store(db, rawPath, raw, 'message/rfc822')
        stored = {
          messageKey: messageKey(parsed?.messageId, raw),
          rawBytes: raw.byteLength,
          rawPath,
          rawSha256: hash
        }
        let htmlPath: string | null = null
        // The HTML copy is UTF-8 and can be bigger than the raw message
        // (8-bit charsets grow); past the bucket's limit only the raw is kept.
        if (
          parsed?.html &&
          new TextEncoder().encode(parsed.html).byteLength <= maxMessageBytes
        ) {
          htmlPath = `${transport.mailbox}/${sha256(parsed.html)}.html`
          await store(db, htmlPath, parsed.html, 'text/html')
        }
        signal = parsed
          ? inboxSignal({
              subject: parsed.subject,
              text: parsed.text,
              html: parsed.html
            })
          : null
        msg = parsed
          ? {
              ...stored,
              kind: 'message',
              htmlPath,
              fromAddress: parsed.fromAddress,
              fromDomain: senderDomain(parsed.fromAddress),
              aliasSlug: aliasSlug(parsed.recipients, transport.base),
              subject: parsed.subject,
              text: parsed.text,
              preview: parsed.preview
            }
          : { ...stored, kind: 'parse_failed', reason: 'unreadable' }
      }
      let recorded = await record(item, msg)
      const refusedFirst = Boolean(recorded.error)
      // One message the database refuses (odd text, odd sender) is kept for
      // a person, so it never blocks the messages after it.
      if (
        recorded.error &&
        stored &&
        msg.kind === 'message' &&
        contentRefusals.has(recorded.error.code)
      )
        recorded = await record(item, {
          ...stored,
          kind: 'parse_failed',
          reason: `refused_${recorded.error.code.toLowerCase()}`
        })
      if (recorded.error) throw recorded.error
      const result = recorded.data as {
        duplicate?: boolean
        state?: string
      } | null
      // INB-004: every kept email is noted, also when a retry finds it
      // already recorded (so nothing is lost between the two calls): the
      // text of an email waiting for a brand, and a confirmation or "you
      // are unsubscribed" notice for the confirm worker or a person. The
      // database acts on a signal once.
      if (
        !refusedFirst &&
        msg.kind === 'message' &&
        (signal || result?.state === 'unassigned' || result?.duplicate)
      ) {
        const flagged = await db.rpc('flag_inbox_message', {
          ...lease,
          message_key: String(msg.messageKey),
          signal: signal?.signal,
          confirm_url:
            signal?.signal === 'opt_in'
              ? (signal.confirmUrl ?? undefined)
              : undefined,
          text_part:
            typeof msg.text === 'string' && msg.text
              ? msg.text.slice(0, 10_000)
              : undefined
        })
        if (flagged.error) throw flagged.error
      }
      if (result?.duplicate) counts.duplicates++
      else if (result?.state === 'assigned') counts.recorded++
      else if (result?.state === 'unassigned') counts.unassigned++
      else counts.skipped++
      // The cursor moves after every message, so a crash repeats nothing.
      const moved = await db.rpc('advance_inbox_cursor', {
        ...lease,
        uid_validity: listing.uidValidity,
        last_seen: item.uid
      })
      if (moved.error) throw moved.error
      done.push(item.uid)
    }
    const more =
      done.length < listing.messages.length ||
      listing.messages.length === limits.messagesPerPoll
    const finished = await db.rpc('finish_platform_job', {
      ...lease,
      outcome: { ...counts, more }
    })
    if (finished.error) throw finished.error
    return { state: 'done', ...counts, more }
  } catch (error) {
    const failure =
      error instanceof InboundTransportError ? error : workerFailure(error)
    const failed = await db.rpc('fail_platform_job', {
      ...lease,
      failure: failure.kind === 'too_large' ? 'protocol' : failure.kind,
      error_code: failure.code
    })
    if (failed.error)
      logger.warn('Inbox poll failure not recorded', {
        code: failed.error.code ?? 'unknown',
        failure: failure.code
      })
    return { state: 'failed', code: failure.code }
  } finally {
    // Read marks are only a convenience in Gmail: the cursor is the record.
    if (session && done.length)
      await session.markProcessed(done).catch(() => {})
    await session?.close().catch(() => {})
  }
}

/** A safe code for a database or storage failure during a poll. */
function workerFailure(error: unknown) {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === 'PT409')
    return new InboundTransportError(
      'unavailable',
      /stored copy missing/i.test(e.message ?? '')
        ? 'stored_copy_missing'
        : /lease/i.test(e.message ?? '')
          ? 'lease_lost'
          : 'inbox_conflict'
    )
  return new InboundTransportError('internal', 'inbox_worker_error')
}
