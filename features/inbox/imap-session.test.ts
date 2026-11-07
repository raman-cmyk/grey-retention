// @vitest-environment node
import { createServer, type AddressInfo, type Server } from 'node:net'
import { ImapFlow } from 'imapflow'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { InboundTransportError } from '@/lib/providers/inbound-capture'
import { sampleNewsletter } from './fake-transport'
import { gmailImapTransport, gmailOptions, type ImapClient } from './imap'

/**
 * The real ImapFlow client against a local server that replays a recorded
 * Gmail IMAP exchange (greeting, AUTHENTICATE PLAIN, SELECT, UID SEARCH,
 * UID FETCH, UID STORE, LOGOUT). Plain TCP on 127.0.0.1: no network, no
 * Gmail. The server records every command the client sends.
 */
const user = 'sampleinbox@gmail.com'
const password = 'abcdabcdabcdabcd'

type Stored = { uid: number; raw: Buffer; date: string }

const gmail = (slug: string, day: number) =>
  Buffer.from(
    sampleNewsletter({
      slug,
      fromDomain: `mail.${slug}.example`,
      subject: `News ${day}`,
      day,
      html: true
    }).raw.replaceAll(
      `capture+${slug}@inbox.example`,
      `sampleinbox+${slug}@gmail.com`
    )
  )

function recordedGmail(options: {
  uidValidity?: number
  mailbox?: Stored[]
  /** Cut the connection when the client sends this command. */
  dropOn?: string
}) {
  const uidValidity = options.uidValidity ?? 7
  const mailbox = options.mailbox ?? [
    { uid: 10, raw: gmail('northwind', 2), date: '02-Nov-2026 15:00:01 +0000' },
    { uid: 11, raw: gmail('juniper', 3), date: '03-Nov-2026 15:00:01 +0000' },
    { uid: 12, raw: gmail('cedar-lane', 4), date: '04-Nov-2026 15:00:01 +0000' }
  ]
  const commands: string[] = []
  const flags = new Map<number, string[]>()
  const capability =
    'IMAP4rev1 UNSELECT IDLE NAMESPACE UIDPLUS CHILDREN X-GM-EXT-1'

  const server = createServer((socket) => {
    let buffer = ''
    let authenticating: string | null = null
    const send = (s: string | Buffer) => socket.write(s)
    const seqOf = (uid: number) => mailbox.findIndex((m) => m.uid === uid) + 1
    const uidsIn = (set: string) => {
      const last = mailbox.at(-1)?.uid ?? 0
      const wanted = new Set<number>()
      for (const part of set.split(',')) {
        const [a, b] = part.split(':')
        const lo = a === '*' ? last : Number(a)
        const hi = b === undefined ? lo : b === '*' ? last : Number(b)
        const [from, to] = lo <= hi ? [lo, hi] : [hi, lo]
        for (const m of mailbox)
          if (m.uid >= from && m.uid <= to) wanted.add(m.uid)
        // Like Gmail: "n:*" always matches the last message.
        if (b === '*' && mailbox.length) wanted.add(last)
      }
      return [...wanted].sort((x, y) => x - y)
    }

    const handle = (line: string) => {
      if (authenticating) {
        const tag = authenticating
        authenticating = null
        commands.push('<sasl response>')
        const [, u, p] = Buffer.from(line, 'base64').toString().split('\0')
        if (u === user && p === password)
          send(`${tag} OK ${user} authenticated (Success)\r\n`)
        else
          send(
            `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`
          )
        return
      }
      commands.push(line)
      const [tag, ...rest] = line.split(' ')
      const verb = (rest[0] ?? '').toUpperCase()
      const uidVerb = verb === 'UID' ? (rest[1] ?? '').toUpperCase() : null
      if (options.dropOn && (uidVerb ?? verb) === options.dropOn) {
        socket.destroy()
        return
      }
      if (verb === 'CAPABILITY') {
        send(
          `* CAPABILITY ${capability} AUTH=PLAIN\r\n${tag} OK Thats all she wrote!\r\n`
        )
      } else if (verb === 'AUTHENTICATE') {
        authenticating = tag!
        send('+ \r\n')
      } else if (verb === 'NAMESPACE') {
        send(`* NAMESPACE (("" "/")) NIL NIL\r\n${tag} OK Success\r\n`)
      } else if (verb === 'LIST') {
        send(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK Success\r\n`)
      } else if (verb === 'SELECT' || verb === 'EXAMINE') {
        send(
          [
            '* FLAGS (\\Answered \\Flagged \\Draft \\Deleted \\Seen)',
            '* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Draft \\Deleted \\Seen \\*)] Flags permitted.',
            `* OK [UIDVALIDITY ${uidValidity}] UIDs valid.`,
            `* ${mailbox.length} EXISTS`,
            '* 0 RECENT',
            `* OK [UIDNEXT ${(mailbox.at(-1)?.uid ?? 0) + 1}] Predicted next UID.`,
            `${tag} OK [READ-WRITE] INBOX selected. (Success)`,
            ''
          ].join('\r\n')
        )
      } else if (uidVerb === 'SEARCH') {
        const set = rest.at(-1) ?? ''
        send(
          `* SEARCH ${uidsIn(set).join(' ')}\r\n${tag} OK SEARCH completed (Success)\r\n`
        )
      } else if (uidVerb === 'FETCH') {
        const body = /BODY\.PEEK\[\](?:<0\.(\d+)>)?/.exec(line)
        const gmId = /X-GM-MSGID/.test(line)
        for (const uid of uidsIn(rest[2] ?? '')) {
          const m = mailbox.find((x) => x.uid === uid)!
          const id = gmId ? ` X-GM-MSGID ${1_790_000_000_000_000 + uid}` : ''
          if (body) {
            const bytes = body[1] ? m.raw.subarray(0, Number(body[1])) : m.raw
            send(
              Buffer.concat([
                Buffer.from(
                  `* ${seqOf(uid)} FETCH (UID ${uid}${id} BODY[]${body[1] ? '<0>' : ''} {${bytes.length}}\r\n`
                ),
                bytes,
                Buffer.from(')\r\n')
              ])
            )
          } else
            send(
              `* ${seqOf(uid)} FETCH (UID ${uid}${id} RFC822.SIZE ${m.raw.length} INTERNALDATE "${m.date}")\r\n`
            )
        }
        send(`${tag} OK Success\r\n`)
      } else if (uidVerb === 'STORE') {
        for (const uid of uidsIn(rest[2] ?? '')) {
          flags.set(uid, ['\\Seen'])
          if (!/SILENT/i.test(line))
            send(`* ${seqOf(uid)} FETCH (UID ${uid} FLAGS (\\Seen))\r\n`)
        }
        send(`${tag} OK Success\r\n`)
      } else if (verb === 'LOGOUT') {
        send(`* BYE LOGOUT Requested\r\n${tag} OK 73 good day (Success)\r\n`)
        socket.end()
      } else {
        send(`${tag} OK Success\r\n`)
      }
    }

    send(
      `* OK [CAPABILITY ${capability} AUTH=PLAIN] Gimap ready for requests\r\n`
    )
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1')
      let at: number
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        handle(line)
      }
    })
    socket.on('error', () => {})
  })
  return { server, commands, flags, mailbox }
}

const running: Server[] = []
afterEach(async () => {
  await Promise.all(
    running.splice(0).map((s) => new Promise((done) => s.close(done)))
  )
})

async function start(options: Parameters<typeof recordedGmail>[0] = {}) {
  const gmailServer = recordedGmail(options)
  await new Promise<void>((done) =>
    gmailServer.server.listen(0, '127.0.0.1', done)
  )
  running.push(gmailServer.server)
  const { port } = gmailServer.server.address() as AddressInfo
  const transport = gmailImapTransport(
    { user, password },
    (settings) =>
      new ImapFlow({
        ...settings,
        // Only the address changes: same login, logger and timeouts.
        host: '127.0.0.1',
        port,
        secure: false,
        tls: undefined,
        doSTARTTLS: false
      }) as unknown as ImapClient
  )
  return { ...gmailServer, transport }
}

describe('Gmail IMAP transport against a recorded session', () => {
  it('lists new UIDs with sizes, fetches with BODY.PEEK[], marks \\Seen and logs out', async () => {
    const gmail = await start()
    const session = await gmail.transport.open()
    const listing = await session.list({ uidValidity: 7, lastUid: 9 }, 25)
    expect(listing.uidValidity).toBe(7)
    expect(listing.messages.map((m) => m.uid)).toEqual([10, 11, 12])
    expect(listing.messages[0]).toMatchObject({
      size: gmail.mailbox[0]!.raw.length,
      transportId: '1790000000000010',
      internalDate: '2026-11-02T15:00:01.000Z'
    })
    const raw = await session.fetchRaw(10, 10 * 1024 * 1024)
    expect(Buffer.from(raw).equals(gmail.mailbox[0]!.raw)).toBe(true)
    await session.markProcessed([10])
    await session.close()

    const sent = gmail.commands.join('\n')
    // Reading never marks a message read: only BODY.PEEK[] is fetched.
    // At most one byte over the 10 MiB limit is asked for.
    expect(sent).toMatch(/UID FETCH 10 \(UID BODY\.PEEK\[\]<0\.10485761>/)
    expect(sent).not.toMatch(/BODY\[\]/)
    // The only change is \Seen on what was processed.
    expect(sent).toMatch(/UID STORE 10 \+FLAGS(\.SILENT)? \(\\Seen\)/)
    expect([...gmail.flags.keys()]).toEqual([10])
    // Nothing is ever deleted, moved, copied or expunged.
    expect(sent).not.toMatch(/EXPUNGE|MOVE|COPY|DELETE|\\Deleted/i)
    // The password only ever travels inside the SASL response.
    expect(sent).not.toContain(password)
    expect(gmail.commands).toContain('<sasl response>')
    expect(gmail.commands.at(-1)).toMatch(/LOGOUT$/)
  })

  it('finds nothing when the cursor is at the newest UID (IMAP answers "13:*" with 12)', async () => {
    const gmail = await start()
    const session = await gmail.transport.open()
    const listing = await session.list({ uidValidity: 7, lastUid: 12 }, 25)
    await session.close()
    expect(listing.messages).toEqual([])
    expect(gmail.commands.join('\n')).toMatch(/UID SEARCH UID 13:\*/)
    expect(gmail.commands.join('\n')).not.toMatch(/UID FETCH/)
  })

  it('starts over from UID 1 when UIDVALIDITY changed, and honours the limit', async () => {
    const gmail = await start({ uidValidity: 8 })
    const session = await gmail.transport.open()
    const listing = await session.list({ uidValidity: 7, lastUid: 900 }, 2)
    await session.close()
    expect(listing.uidValidity).toBe(8)
    expect(listing.messages.map((m) => m.uid)).toEqual([10, 11])
    expect(gmail.commands.join('\n')).toMatch(/UID SEARCH UID 1:\*/)
  })

  it('turns a dropped connection into a retryable error without crashing the sweep', async () => {
    const gmail = await start({ dropOn: 'SEARCH' })
    const session = await gmail.transport.open()
    await expect(
      session.list({ uidValidity: 7, lastUid: 9 }, 25)
    ).rejects.toBeInstanceOf(InboundTransportError)
    await session.close()
  })

  it('refuses a message bigger than the limit after download', async () => {
    const gmail = await start()
    const session = await gmail.transport.open()
    await expect(session.fetchRaw(11, 100)).rejects.toMatchObject({
      kind: 'too_large',
      code: 'message_too_large'
    })
    await session.close()
  })

  it('reports a refused login as "auth" with no server text or password', async () => {
    const gmailServer = recordedGmail({})
    await new Promise<void>((done) =>
      gmailServer.server.listen(0, '127.0.0.1', done)
    )
    running.push(gmailServer.server)
    const { port } = gmailServer.server.address() as AddressInfo
    const wrong = 'wrongwrongwrongw'
    const transport = gmailImapTransport(
      { user, password: wrong },
      (settings) =>
        new ImapFlow({
          ...settings,
          host: '127.0.0.1',
          port,
          secure: false,
          tls: undefined,
          doSTARTTLS: false
        }) as unknown as ImapClient
    )
    const error = await transport.open().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(InboundTransportError)
    expect(error).toMatchObject({ kind: 'auth', code: 'imap_auth_failed' })
    expect(JSON.stringify(error) + String(error)).not.toMatch(
      /wrongwrong|Invalid credentials|sampleinbox/
    )
    expect(gmailServer.commands.join('\n')).not.toMatch(/SELECT|FETCH/)
  })

  it('keeps the real settings apart from the test address', () => {
    expect(gmailOptions({ user, password })).toMatchObject({
      host: 'imap.gmail.com',
      secure: true
    })
  })
})
