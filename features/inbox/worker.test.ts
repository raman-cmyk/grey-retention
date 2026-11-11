// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { InboundCaptureTransport } from '@/lib/providers/inbound-capture'

vi.mock('server-only', () => ({}))
import { InboundTransportError } from '@/lib/providers/inbound-capture'
import {
  fakeInboundTransport,
  sampleMailbox,
  sampleNewsletter
} from './fake-transport'
import { pollInbox } from './worker'

/** An in-memory stand-in for the inbox RPCs and the private bucket. */
function database(
  options: {
    paused?: boolean
    busy?: boolean
    cursor?: { uidValidity: number; lastUid: number }
    existing?: string[]
    /** A database refusal for one recorded message. */
    refuse?: (
      msg: Record<string, unknown>
    ) => { code: string; message: string } | null
    uploadError?: { message: string; statusCode: string | number }
    advanceError?: { code: string; message: string }
    failError?: { code: string; message: string }
    flagError?: { code: string; message: string }
  } = {}
) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const stored = new Map<string, string>()
  for (const path of options.existing ?? []) stored.set(path, 'x')
  const keys = new Set<string>()
  const cursor = {
    uidValidity: options.cursor?.uidValidity ?? (null as number | null),
    lastUid: options.cursor?.lastUid ?? 0
  }
  const db = {
    calls,
    stored,
    cursor,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      switch (name) {
        case 'enqueue_inbox_poll':
          return { data: options.paused ? null : 'job-1', error: null }
        case 'claim_platform_job':
          return {
            data: options.busy
              ? []
              : [
                  {
                    id: 'job-1',
                    lease_token: 'lease-1',
                    context: {
                      uidValidity: cursor.uidValidity,
                      lastUid: cursor.lastUid
                    }
                  }
                ],
            error: null
          }
        case 'record_inbox_message': {
          const msg = args.msg as Record<string, unknown>
          const refused = options.refuse?.(msg)
          if (refused) return { data: null, error: refused }
          if (msg.kind !== 'too_large' && !stored.has(String(msg.rawPath)))
            return {
              data: null,
              error: { code: 'PT409', message: 'Stored copy missing' }
            }
          if (keys.has(String(msg.messageKey)))
            return { data: { duplicate: true }, error: null }
          keys.add(String(msg.messageKey))
          const state =
            msg.kind !== 'message'
              ? msg.kind
              : msg.aliasSlug === 'northwind'
                ? 'assigned'
                : 'unassigned'
          return { data: { duplicate: false, state }, error: null }
        }
        case 'fail_platform_job':
          return { data: null, error: options.failError ?? null }
        case 'flag_inbox_message':
          return options.flagError
            ? { data: null, error: options.flagError }
            : { data: { already: false }, error: null }
        case 'advance_inbox_cursor':
          if (options.advanceError)
            return { data: null, error: options.advanceError }
          cursor.uidValidity = Number(args.uid_validity)
          cursor.lastUid = Math.max(cursor.lastUid, Number(args.last_seen))
          return { data: null, error: null }
        default:
          return { data: null, error: null }
      }
    }),
    storage: {
      from: (bucket: string) => ({
        upload: vi.fn(async (path: string, body: Uint8Array | string) => {
          expect(bucket).toBe('inbox-raw')
          if (options.uploadError)
            return { data: null, error: options.uploadError }
          if (stored.has(path))
            return {
              data: null,
              error: {
                message: 'The resource already exists',
                statusCode: '409'
              }
            }
          stored.set(
            path,
            typeof body === 'string' ? body : new TextDecoder().decode(body)
          )
          return { data: { path }, error: null }
        })
      })
    }
  }
  return db
}
type Db = Parameters<typeof pollInbox>[0]
const names = (db: ReturnType<typeof database>) => db.calls.map((c) => c.name)

describe('pollInbox', () => {
  it('stores, records and assigns every new sample message once, moving the cursor each time', async () => {
    const db = database()
    const transport = fakeInboundTransport()
    const run = await pollInbox(db as unknown as Db, transport)
    expect(run).toEqual({
      state: 'done',
      recorded: 1,
      duplicates: 0,
      unassigned: 2,
      skipped: 0,
      more: false
    })
    // One .eml per message and one .html per HTML message, under the mailbox.
    const paths = [...db.stored.keys()]
    expect(
      paths.filter((p) => /^fake\/[a-f0-9]{64}\.eml$/.test(p))
    ).toHaveLength(3)
    expect(
      paths.filter((p) => /^fake\/[a-f0-9]{64}\.html$/.test(p))
    ).toHaveLength(2)
    const recorded = db.calls
      .filter((c) => c.name === 'record_inbox_message')
      .map((c) => c.args.msg as Record<string, unknown>)
    expect(recorded[0]).toMatchObject({
      kind: 'message',
      uid: 1,
      uidValidity: 1,
      aliasSlug: 'northwind',
      fromDomain: 'mail.northwind.example',
      subject: 'Spring layers are here',
      synthetic: true,
      receivedAt: sampleMailbox[0]!.internalDate
    })
    expect(recorded[1]).toMatchObject({
      aliasSlug: null,
      fromDomain: 'news.cedar-lane.example'
    })
    // record → cursor, per message; then finish.
    expect(names(db).filter((n) => n === 'advance_inbox_cursor')).toHaveLength(
      3
    )
    expect(names(db).at(-1)).toBe('finish_platform_job')
    expect(db.cursor).toEqual({ uidValidity: 1, lastUid: 3 })
    expect(transport.processed).toEqual([1, 2, 3])
    // The next poll finds nothing new.
    const again = await pollInbox(db as unknown as Db, transport)
    expect(again).toMatchObject({ state: 'done', recorded: 0, unassigned: 0 })
  })

  it('notes a confirmation for the confirm worker, and keeps the text of an email waiting for a brand', async () => {
    const confirm = sampleNewsletter({
      slug: 'northwind',
      fromDomain: 'mail.northwind.example',
      subject: 'Please confirm your subscription',
      day: 6,
      html: true
    })
    const waiting = sampleNewsletter({
      slug: null,
      fromDomain: 'news.cedar.example',
      subject: 'Linen week',
      day: 7
    })
    const ordinary = sampleNewsletter({
      slug: 'northwind',
      fromDomain: 'mail.northwind.example',
      subject: 'New linen',
      day: 8
    })
    const db = database()
    await pollInbox(
      db as unknown as Db,
      fakeInboundTransport([confirm, waiting, ordinary])
    )
    const flags = db.calls
      .filter((c) => c.name === 'flag_inbox_message')
      .map((c) => c.args)
    expect(flags).toEqual([
      expect.objectContaining({ signal: 'opt_in', confirm_url: undefined }),
      expect.objectContaining({
        signal: undefined,
        text_part: expect.stringContaining('Linen week')
      })
    ])
    // An ordinary newsletter that found its brand needs no note.
    expect(flags).toHaveLength(2)
  })

  it('notes a re-delivered email again, so a signal is never lost between two calls', async () => {
    const confirm = sampleNewsletter({
      slug: 'northwind',
      fromDomain: 'mail.northwind.example',
      subject: 'Please confirm your subscription',
      day: 6
    })
    const db = database()
    await pollInbox(
      db as unknown as Db,
      fakeInboundTransport([confirm, confirm])
    )
    expect(
      db.calls.filter((c) => c.name === 'flag_inbox_message')
    ).toHaveLength(2)
  })

  it('does not note a message the database refused, and fails the poll when a note fails', async () => {
    const confirm = sampleNewsletter({
      slug: 'northwind',
      fromDomain: 'mail.northwind.example',
      subject: 'Please confirm your subscription',
      day: 6
    })
    const refusing = database({
      refuse: (msg) =>
        msg.kind === 'message' ? { code: '23514', message: 'odd' } : null
    })
    await pollInbox(refusing as unknown as Db, fakeInboundTransport([confirm]))
    expect(names(refusing)).not.toContain('flag_inbox_message')
    const failing = database({
      flagError: { code: 'XX000', message: 'down' }
    })
    await pollInbox(failing as unknown as Db, fakeInboundTransport([confirm]))
    expect(names(failing)).toContain('fail_platform_job')
    expect(names(failing)).not.toContain('advance_inbox_cursor')
  })

  it('counts a message re-delivered under a new UID as a duplicate', async () => {
    const first = sampleNewsletter({
      slug: 'northwind',
      fromDomain: 'mail.northwind.example',
      subject: 'Same',
      day: 5
    })
    const db = database()
    const run = await pollInbox(
      db as unknown as Db,
      fakeInboundTransport([first, first])
    )
    expect(run).toMatchObject({ recorded: 1, duplicates: 1 })
  })

  it('records an oversized message without downloading it, and an unreadable one with its raw copy', async () => {
    const db = database()
    const huge = {
      raw: 'x'.repeat(11 * 1024 * 1024),
      internalDate: '2026-11-02T10:00:00.000Z'
    }
    const junk = {
      raw: 'not an email at all',
      internalDate: '2026-11-02T10:00:00.000Z'
    }
    const run = await pollInbox(
      db as unknown as Db,
      fakeInboundTransport([huge, junk])
    )
    expect(run).toMatchObject({ state: 'done', skipped: 2 })
    const kinds = db.calls
      .filter((c) => c.name === 'record_inbox_message')
      .map((c) => c.args.msg as { kind: string; rawPath?: string })
    expect(kinds[0]).toMatchObject({ kind: 'too_large' })
    expect(kinds[0]?.rawPath).toBeUndefined()
    expect(kinds[1]).toMatchObject({
      kind: 'parse_failed',
      reason: 'unreadable'
    })
    expect([...db.stored.keys()]).toHaveLength(1)
  })

  it('treats an already stored copy as stored', async () => {
    const db = database()
    await pollInbox(db as unknown as Db, fakeInboundTransport())
    const again = database({ existing: [...db.stored.keys()] })
    const run = await pollInbox(again as unknown as Db, fakeInboundTransport())
    expect(run).toMatchObject({ state: 'done', recorded: 1, unassigned: 2 })
  })

  it('fails the job with a safe code when the login is refused', async () => {
    const db = database()
    const run = await pollInbox(
      db as unknown as Db,
      fakeInboundTransport(sampleMailbox, {
        fail: new InboundTransportError('auth', 'imap_auth_failed')
      })
    )
    expect(run).toEqual({ state: 'failed', code: 'imap_auth_failed' })
    expect(db.calls.at(-1)).toMatchObject({
      name: 'fail_platform_job',
      args: { failure: 'auth', error_code: 'imap_auth_failed' }
    })
    expect(names(db)).not.toContain('record_inbox_message')
  })

  it('does nothing while the mailbox is paused or another poll runs', async () => {
    expect(
      await pollInbox(
        database({ paused: true }) as unknown as Db,
        fakeInboundTransport()
      )
    ).toEqual({ state: 'paused' })
    const busy = database({ busy: true })
    expect(
      await pollInbox(busy as unknown as Db, fakeInboundTransport())
    ).toEqual({ state: 'busy' })
    expect(names(busy)).toEqual(['enqueue_inbox_poll', 'claim_platform_job'])
  })

  it('stops starting messages when its time is up, and says there is more', async () => {
    let t = 0
    const db = database()
    const run = await pollInbox(db as unknown as Db, fakeInboundTransport(), {
      now: () => (t += 15_000),
      limits: { budgetMs: 20_000 }
    })
    expect(run).toMatchObject({ state: 'done', more: true })
    expect(db.cursor.lastUid).toBe(1)
  })

  it('keeps a message the database refuses for a person and goes on to the next', async () => {
    // e.g. a sender domain or text the database will not take.
    const db = database({
      refuse: (msg) =>
        msg.kind === 'message' && msg.uid === 1
          ? { code: '23514', message: 'Invalid inbox message' }
          : null
    })
    const transport = fakeInboundTransport()
    const run = await pollInbox(db as unknown as Db, transport)
    expect(run).toMatchObject({ state: 'done', skipped: 1, unassigned: 2 })
    const first = db.calls
      .filter((c) => c.name === 'record_inbox_message')
      .map((c) => c.args.msg as Record<string, unknown>)
      .filter((m) => m.uid === 1)
    expect(first.map((m) => m.kind)).toEqual(['message', 'parse_failed'])
    expect(first[1]).toMatchObject({ reason: 'refused_23514' })
    expect(db.cursor.lastUid).toBe(3)
    expect(transport.processed).toEqual([1, 2, 3])
  })

  it('records a message bigger than the server said as too large, without storing it', async () => {
    const db = database()
    const inner = fakeInboundTransport([
      {
        raw: 'x'.repeat(11 * 1024 * 1024),
        internalDate: sampleMailbox[0]!.internalDate
      }
    ])
    const transport: InboundCaptureTransport = {
      ...inner,
      async open() {
        const session = await inner.open()
        return {
          ...session,
          async list(cursor, limit) {
            const listing = await session.list(cursor, limit)
            return {
              ...listing,
              messages: listing.messages.map((m) => ({
                ...m,
                size: 100,
                transportId: 'gm-1'
              }))
            }
          }
        }
      }
    }
    const run = await pollInbox(db as unknown as Db, transport)
    expect(run).toMatchObject({ state: 'done', skipped: 1 })
    expect(db.stored.size).toBe(0)
    const msg = db.calls.find((c) => c.name === 'record_inbox_message')!.args
      .msg as Record<string, unknown>
    expect(msg).toMatchObject({ kind: 'too_large', transportId: 'gm-1' })
  })

  it('fails the poll with a safe code when storage refuses, and moves nothing', async () => {
    const db = database({
      uploadError: { message: 'Internal error: bucket detail', statusCode: 500 }
    })
    const run = await pollInbox(db as unknown as Db, fakeInboundTransport())
    expect(run).toEqual({ state: 'failed', code: 'storage_upload_failed' })
    expect(names(db)).not.toContain('record_inbox_message')
    expect(db.cursor.lastUid).toBe(0)
  })

  it('names a lost lease, still marks what was done, and logs a failure it could not record', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const transport = fakeInboundTransport()
    let advances = 0
    const db = database({
      failError: { code: 'PT409', message: 'Stale platform job lease' }
    })
    const rpc = db.rpc.getMockImplementation()!
    db.rpc.mockImplementation(async (name, args) => {
      if (name === 'advance_inbox_cursor' && ++advances === 2)
        return {
          data: null,
          error: { code: 'PT409', message: 'Stale platform job lease' }
        }
      return rpc(name, args)
    })
    const run = await pollInbox(db as unknown as Db, transport)
    expect(run).toEqual({ state: 'failed', code: 'lease_lost' })
    // The first message was recorded and passed: it is still marked read.
    expect(transport.processed).toEqual([1])
    expect(JSON.stringify(warn.mock.calls)).toContain('PT409')
    warn.mockRestore()
  })

  it('names a missing stored copy apart from a lost lease', async () => {
    const db = database({
      refuse: () => ({ code: 'PT409', message: 'Stored copy missing' })
    })
    expect(
      await pollInbox(db as unknown as Db, fakeInboundTransport())
    ).toEqual({ state: 'failed', code: 'stored_copy_missing' })
  })

  it('keeps only the raw copy when the HTML copy would be over the bucket limit', async () => {
    // 8-bit ISO-8859-1: each é is one byte raw and two bytes as UTF-8.
    const raw = Buffer.from(
      [
        'From: news@mail.northwind.example',
        'To: capture+northwind@inbox.example',
        'Subject: Big',
        'Content-Type: text/html; charset=ISO-8859-1',
        'Content-Transfer-Encoding: 8bit',
        '',
        `<p>${'é'.repeat(5_400_000)}</p>`,
        ''
      ].join('\r\n'),
      'latin1'
    )
    const inner = fakeInboundTransport()
    const transport: InboundCaptureTransport = {
      ...inner,
      async open() {
        const session = await inner.open()
        return {
          ...session,
          list: async () => ({
            uidValidity: 1,
            messages: [
              {
                uid: 1,
                size: raw.byteLength,
                transportId: null,
                internalDate: sampleMailbox[0]!.internalDate
              }
            ]
          }),
          fetchRaw: async () => new Uint8Array(raw)
        }
      }
    }
    const db = database()
    const run = await pollInbox(db as unknown as Db, transport)
    expect(run).toMatchObject({ state: 'done', recorded: 1 })
    expect([...db.stored.keys()].filter((p) => p.endsWith('.html'))).toEqual([])
    const msg = db.calls.find((c) => c.name === 'record_inbox_message')!.args
      .msg as Record<string, unknown>
    expect(msg.htmlPath).toBeNull()
  })
})
