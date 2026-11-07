import 'server-only'
import { ImapFlow, type ImapFlowOptions } from 'imapflow'
import {
  InboundTransportError,
  type InboundCaptureTransport,
  type InboundSession
} from '@/lib/providers/inbound-capture'

/** The part of ImapFlow the adapter uses (so tests can stand in for it). */
export type ImapClient = Pick<
  ImapFlow,
  | 'connect'
  | 'getMailboxLock'
  | 'search'
  | 'fetch'
  | 'fetchOne'
  | 'messageFlagsAdd'
  | 'logout'
  | 'on'
> & { mailbox: ImapFlow['mailbox']; usable?: boolean }

export type ImapConfig = { user: string; password: string }

/**
 * Fixed settings: Gmail over TLS (1.2+), no logging, short timeouts (the
 * whole poll has about 15 seconds inside the minute-long sweep).
 */
export function gmailOptions(config: ImapConfig): ImapFlowOptions {
  return {
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: config.user, pass: config.password },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 8_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000
  }
}

/**
 * A safe error for anything ImapFlow throws. Server text and credentials
 * are never copied: only a kind and a fixed code.
 */
export function imapError(error: unknown): InboundTransportError {
  if (error instanceof InboundTransportError) return error
  const e = (error ?? {}) as {
    authenticationFailed?: boolean
    code?: string
    serverResponseCode?: string
  }
  if (e.authenticationFailed || e.serverResponseCode === 'AUTHENTICATIONFAILED')
    return new InboundTransportError('auth', 'imap_auth_failed')
  if (
    e.code === 'ETIMEDOUT' ||
    e.code === 'ESOCKETTIMEOUT' ||
    e.code === 'CONNECT_TIMEOUT' ||
    e.code === 'GREETING_TIMEOUT'
  )
    return new InboundTransportError('timeout', 'imap_timeout')
  if (
    e.code === 'ECONNREFUSED' ||
    e.code === 'ENOTFOUND' ||
    e.code === 'ECONNRESET' ||
    e.code === 'NoConnection' ||
    e.code === 'EAI_AGAIN'
  )
    return new InboundTransportError('unavailable', 'imap_unavailable')
  return new InboundTransportError('protocol', 'imap_protocol_error')
}

/**
 * The Gmail inbox over IMAP (BUILD_BRIEF D4). It reads INBOX only: lists
 * UIDs above the cursor, checks each size before downloading, fetches with
 * BODY.PEEK[] (reading does not mark it), and finally marks processed
 * messages \Seen. It never deletes, moves or expunges.
 */
export function gmailImapTransport(
  config: ImapConfig,
  connect: (options: ImapFlowOptions) => ImapClient = (options) =>
    new ImapFlow(options)
): InboundCaptureTransport {
  const at = config.user.lastIndexOf('@')
  return {
    kind: 'gmail_imap',
    mailbox: 'gmail',
    synthetic: false,
    base: {
      local: config.user.slice(0, at).toLowerCase(),
      domain: config.user.slice(at + 1).toLowerCase()
    },
    async open(): Promise<InboundSession> {
      const client = connect(gmailOptions(config))
      // ImapFlow emits "error" when the connection drops; with no listener
      // Node would throw it and end the whole sweep. The next command then
      // fails with NoConnection, which the guard below maps to a safe error.
      client.on('error', () => {})
      let release: (() => void) | null = null
      try {
        await client.connect()
        release = (await client.getMailboxLock('INBOX')).release
      } catch (error) {
        await client.logout().catch(() => {})
        throw imapError(error)
      }
      // ImapFlow answers some failed commands with `false` instead of
      // throwing; after a dropped connection that means "connection lost".
      const refused = (code: string) =>
        client.usable === false
          ? new InboundTransportError('unavailable', 'imap_connection_lost')
          : new InboundTransportError('protocol', code)
      const guard = async <T>(work: () => Promise<T>) => {
        try {
          return await work()
        } catch (error) {
          throw imapError(error)
        }
      }
      return {
        list: (cursor, limit) =>
          guard(async () => {
            const box = client.mailbox
            if (!box || typeof box === 'boolean')
              throw new InboundTransportError('protocol', 'imap_no_mailbox')
            const uidValidity = Number(box.uidValidity)
            const from = cursor.uidValidity === uidValidity ? cursor.lastUid : 0
            // IMAP answers "n:*" with the last message even when nothing is newer.
            const found = await client.search(
              { uid: `${from + 1}:*` },
              { uid: true }
            )
            if (found === false) throw refused('imap_search_failed')
            const uids = found
              .filter((uid) => uid > from)
              .sort((a, b) => a - b)
              .slice(0, limit)
            const messages: Awaited<
              ReturnType<InboundSession['list']>
            >['messages'] = []
            if (uids.length)
              for await (const m of client.fetch(
                uids,
                { uid: true, size: true, internalDate: true },
                { uid: true }
              ))
                messages.push({
                  uid: m.uid,
                  size: m.size ?? 0,
                  transportId: m.emailId ?? null,
                  internalDate: new Date(
                    m.internalDate ?? Date.now()
                  ).toISOString()
                })
            messages.sort((a, b) => a.uid - b.uid)
            return { uidValidity, messages }
          }),
        fetchRaw: (uid, maxBytes) =>
          guard(async () => {
            // At most one byte over the limit is downloaded, even when the
            // server reported a smaller size.
            const m = await client.fetchOne(
              String(uid),
              { uid: true, source: { maxLength: maxBytes + 1 } },
              { uid: true }
            )
            if (!m || !m.source) throw refused('imap_message_missing')
            if (m.source.byteLength > maxBytes)
              throw new InboundTransportError('too_large', 'message_too_large')
            return new Uint8Array(m.source)
          }),
        markProcessed: (uids) =>
          guard(async () => {
            if (
              uids.length &&
              !(await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true }))
            )
              throw refused('imap_flag_failed')
          }),
        async close() {
          release?.()
          await client.logout().catch(() => {})
        }
      }
    }
  }
}
