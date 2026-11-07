// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { InboundTransportError } from '@/lib/providers/inbound-capture'
import { inboxConfig } from './config'
import {
  gmailImapTransport,
  gmailOptions,
  imapError,
  type ImapClient
} from './imap'

const config = {
  user: 'sampleinbox@gmail.com',
  password: 'abcdabcdabcdabcd'
}

/** A stand-in for ImapFlow with a scripted mailbox. */
function client(options: {
  uidValidity?: number
  uids?: number[]
  sizes?: Record<number, number>
  source?: (uid: number) => Buffer | undefined
  connect?: () => Promise<void>
  lock?: () => Promise<void>
  /** What a failed SEARCH returns in ImapFlow. */
  searchFails?: boolean
  noMailbox?: boolean
}) {
  const calls: string[] = []
  const c = {
    calls,
    mailbox: options.noMailbox
      ? (false as const)
      : { path: 'INBOX', uidValidity: BigInt(options.uidValidity ?? 7) },
    usable: true,
    on: vi.fn((event: string) => {
      calls.push(`on:${event}`)
    }),
    connect: vi.fn(async () => {
      calls.push('connect')
      await options.connect?.()
    }),
    getMailboxLock: vi.fn(async (path: string) => {
      calls.push(`lock:${path}`)
      await options.lock?.()
      return { path, release: () => calls.push('release') }
    }),
    search: vi.fn(async (query: { uid: string }) => {
      calls.push(`search:${query.uid}`)
      if (options.searchFails) return false as const
      // Like IMAP, "n:*" also returns the last message when nothing is newer.
      return options.uids ?? []
    }),
    fetch: vi.fn(async function* (uids: number[]) {
      calls.push(`fetch:${uids.join(',')}`)
      for (const uid of uids)
        yield {
          seq: uid,
          uid,
          size: options.sizes?.[uid] ?? 100,
          internalDate: new Date('2026-11-02T10:00:00Z')
        }
    }),
    fetchOne: vi.fn(async (uid: string, query: { source?: boolean }) => {
      calls.push(`fetchOne:${uid}:${query.source ? 'source' : ''}`)
      const source = options.source?.(Number(uid))
      return source ? { seq: 1, uid: Number(uid), source } : false
    }),
    messageFlagsAdd: vi.fn(async (uids: number[], flags: string[]) => {
      calls.push(`flags:${uids.join(',')}:${flags.join(',')}`)
      return true
    }),
    logout: vi.fn(async () => {
      calls.push('logout')
    })
  }
  return c
}

const open = (c: ReturnType<typeof client>) =>
  gmailImapTransport(config, () => c as unknown as ImapClient).open()

describe('Gmail IMAP transport', () => {
  it('uses fixed, safe settings and no logger', () => {
    expect(gmailOptions(config)).toMatchObject({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      logger: false,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
    })
    const t = gmailImapTransport(config)
    expect(t).toMatchObject({
      kind: 'gmail_imap',
      mailbox: 'gmail',
      synthetic: false,
      base: { local: 'sampleinbox', domain: 'gmail.com' }
    })
  })

  it('lists only UIDs above the cursor, oldest first, with their sizes', async () => {
    const c = client({ uids: [12, 10, 11, 9], sizes: { 10: 500 } })
    const session = await open(c)
    const listing = await session.list({ uidValidity: 7, lastUid: 9 }, 2)
    expect(listing.uidValidity).toBe(7)
    expect(listing.messages.map((m) => [m.uid, m.size])).toEqual([
      [10, 500],
      [11, 100]
    ])
    expect(c.calls).toContain('search:10:*')
    expect(c.calls).toContain('lock:INBOX')
  })

  it('starts over when the mailbox UIDVALIDITY changed', async () => {
    const c = client({ uidValidity: 8, uids: [1, 2] })
    const listing = await (
      await open(c)
    ).list({ uidValidity: 7, lastUid: 900 }, 25)
    expect(listing.messages.map((m) => m.uid)).toEqual([1, 2])
    expect(c.calls).toContain('search:1:*')
  })

  it('fetches with BODY.PEEK (source), refuses oversized bytes, and only ever adds \\Seen', async () => {
    const c = client({
      uids: [1],
      source: (uid) =>
        uid === 1 ? Buffer.from('raw message') : Buffer.alloc(50)
    })
    const session = await open(c)
    expect(new TextDecoder().decode(await session.fetchRaw(1, 1000))).toBe(
      'raw message'
    )
    await expect(session.fetchRaw(2, 10)).rejects.toMatchObject({
      kind: 'too_large'
    })
    await session.markProcessed([1])
    await session.close()
    expect(c.calls).toContain('flags:1:\\Seen')
    expect(c.calls.slice(-2)).toEqual(['release', 'logout'])
    // Nothing is ever deleted, moved or expunged.
    expect(Object.keys(c)).not.toContain('messageDelete')
    expect(Object.keys(c)).not.toContain('messageMove')
  })

  it('maps a failed login to "auth" without the server text or the password', async () => {
    const c = client({
      connect: async () => {
        throw Object.assign(
          new Error(
            `Invalid credentials for ${config.user} ${config.password}`
          ),
          {
            authenticationFailed: true,
            responseText: 'secret server text'
          }
        )
      }
    })
    const error = await open(c).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(InboundTransportError)
    expect(error).toMatchObject({ kind: 'auth', code: 'imap_auth_failed' })
    expect(JSON.stringify(error) + String(error)).not.toMatch(
      /abcdabcd|secret server text|sampleinbox/
    )
    expect(c.calls).toContain('logout')
  })

  it('listens for connection errors so a dropped socket cannot crash the sweep', async () => {
    const c = client({})
    await (await open(c)).close()
    expect(c.calls[0]).toBe('on:error')
  })

  it('logs out when the inbox cannot be opened', async () => {
    const c = client({
      lock: async () => {
        throw Object.assign(new Error('x'), { code: 'ECONNRESET' })
      }
    })
    await expect(open(c)).rejects.toMatchObject({ kind: 'unavailable' })
    expect(c.calls.at(-1)).toBe('logout')
  })

  it('treats a refused search or a missing INBOX as an error, not as "nothing new"', async () => {
    const failing = client({ searchFails: true })
    await expect(
      (await open(failing)).list({ uidValidity: 7, lastUid: 0 }, 25)
    ).rejects.toMatchObject({ kind: 'protocol', code: 'imap_search_failed' })
    const lost = client({ searchFails: true })
    const session = await open(lost)
    lost.usable = false
    await expect(
      session.list({ uidValidity: 7, lastUid: 0 }, 25)
    ).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'imap_connection_lost'
    })
    await expect(
      (await open(client({ noMailbox: true }))).list(
        { uidValidity: 7, lastUid: 0 },
        25
      )
    ).rejects.toMatchObject({ code: 'imap_no_mailbox' })
  })

  it('maps timeouts and lost connections to retryable kinds', () => {
    expect(
      imapError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })).kind
    ).toBe('timeout')
    expect(
      imapError(Object.assign(new Error('x'), { code: 'ECONNRESET' })).kind
    ).toBe('unavailable')
    expect(imapError(new Error('BAD something')).kind).toBe('protocol')
  })
})

describe('inboxConfig', () => {
  it('uses the sample inbox by default', () => {
    expect(inboxConfig({})).toMatchObject({
      ready: true,
      transport: { kind: 'fake', synthetic: true }
    })
  })

  it('reads Gmail once both values are set, and the sample inbox when told to', () => {
    const real = {
      INBOX_IMAP_USER: 'SampleInbox@gmail.com',
      INBOX_IMAP_APP_PASSWORD: 'abcd efgh ijkl mnop'
    }
    expect(inboxConfig(real)).toMatchObject({
      ready: true,
      transport: { kind: 'gmail_imap', synthetic: false }
    })
    expect(inboxConfig({ ...real, INBOX_TRANSPORT: 'fake' })).toMatchObject({
      ready: true,
      transport: { kind: 'fake', synthetic: true }
    })
    // On a local database copied values never read the real inbox.
    expect(
      inboxConfig({
        ...real,
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321'
      })
    ).toMatchObject({ ready: true, transport: { kind: 'fake' } })
    expect(
      inboxConfig({
        ...real,
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        INBOX_TRANSPORT: 'gmail_imap'
      })
    ).toMatchObject({ transport: { kind: 'gmail_imap' } })
    // Only one of the two is a mistake, not a reason to read samples.
    expect(
      inboxConfig({ INBOX_IMAP_USER: 'sampleinbox@gmail.com' })
    ).toMatchObject({ ready: false })
  })

  it('needs a Gmail address and a 16-letter app password (spaces allowed)', () => {
    expect(
      inboxConfig({
        INBOX_TRANSPORT: 'gmail_imap',
        INBOX_IMAP_USER: 'SampleInbox@gmail.com',
        INBOX_IMAP_APP_PASSWORD: 'abcd efgh ijkl mnop'
      })
    ).toMatchObject({
      ready: true,
      transport: { kind: 'gmail_imap', base: { local: 'sampleinbox' } }
    })
    const missing = inboxConfig({ INBOX_TRANSPORT: 'gmail_imap' })
    expect(missing).toMatchObject({
      ready: false,
      reason: 'INBOX_IMAP_USER must be the Gmail address of the inbox.'
    })
    const short = inboxConfig({
      INBOX_TRANSPORT: 'gmail_imap',
      INBOX_IMAP_USER: 'a@gmail.com',
      INBOX_IMAP_APP_PASSWORD: 'short1'
    })
    expect(short).toMatchObject({ ready: false })
    // The reason never repeats the value.
    expect(JSON.stringify(short)).not.toContain('short1')
    expect(inboxConfig({ INBOX_TRANSPORT: 'pop3' })).toMatchObject({
      ready: false
    })
  })
})
