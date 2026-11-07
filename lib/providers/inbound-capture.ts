/**
 * The Inspiration inbox port (INB-001, BUILD_BRIEF D4). Competitor
 * newsletters arrive in one mailbox; a transport lists what is new since the
 * cursor, fetches each message's raw bytes and marks what was processed.
 * Today: a fake (the default) and Gmail over IMAP. A catch-all domain can
 * replace Gmail later behind the same port.
 *
 * A transport never deletes, moves or expunges anything.
 */

/** Where the worker stopped last time: IMAP UIDVALIDITY and last UID. */
export type InboundCursor = { uidValidity: number | null; lastUid: number }

export type InboundListing = {
  uidValidity: number
  /** Newer than the cursor, oldest first, at most the limit asked for. */
  messages: {
    uid: number
    /** Size in bytes as the server reports it (checked before fetching). */
    size: number
    /** The server's own message id (Gmail X-GM-MSGID), when it has one. */
    transportId: string | null
    /** When the server received it (ISO 8601). */
    internalDate: string
  }[]
}

export interface InboundSession {
  list(cursor: InboundCursor, limit: number): Promise<InboundListing>
  /** The raw RFC 822 message. Throws `too_large` above `maxBytes`. */
  fetchRaw(uid: number, maxBytes: number): Promise<Uint8Array>
  /** Marks messages read (IMAP \Seen). Never deletes or moves them. */
  markProcessed(uids: number[]): Promise<void>
  close(): Promise<void>
}

export interface InboundCaptureTransport {
  kind: 'fake' | 'gmail_imap'
  /** The `inbox_mailboxes.key` this transport reads. */
  mailbox: 'fake' | 'gmail'
  /** Sample messages (fake) or real newsletters. */
  synthetic: boolean
  /**
   * The inbox's own address, for finding the +alias in recipients, e.g.
   * `{ local: 'capture', domain: 'inbox.example' }`.
   */
  base: { local: string; domain: string }
  open(): Promise<InboundSession>
}

export type InboundErrorKind =
  | 'auth'
  | 'unavailable'
  | 'timeout'
  | 'protocol'
  | 'too_large'
  /** The worker's own failure (database or storage), not the transport's. */
  | 'internal'

/**
 * A transport failure with a safe code. It never carries server text or
 * credentials, so it can be logged and stored as is.
 */
export class InboundTransportError extends Error {
  constructor(
    readonly kind: InboundErrorKind,
    readonly code: string
  ) {
    super(code)
    this.name = 'InboundTransportError'
  }
}
