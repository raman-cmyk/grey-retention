// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const service = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: service }))
import {
  selectedObserverRows,
  observerSelection,
  selectionVersion,
  type ObserverEmail
} from './observer-sheet'
import { observerGmailTransport, type ObserverImap } from './observer-transport'
import { observerAllowed } from './observer-access'
import { messageKey } from './addresses'
import { inboxConfig } from './config'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})
const headers = Array.from({ length: 22 }, () => '')
for (const [i, v] of [
  [0, 'Email ID'],
  [1, 'Brand ID'],
  [2, 'Domain'],
  [6, 'Audit alias'],
  [7, 'Gmail message ID'],
  [8, 'RFC822 Message-ID'],
  [12, 'Human rating'],
  [13, 'Reviewer'],
  [21, 'Schema version']
] as const)
  headers[i] = v
const entry: ObserverEmail = {
  id: 'email-1',
  domain: 'northwind.example',
  alias: 'capture+greyobserver-12345678901234567890123456789012@gmail.com',
  sender: 'news@northwind.example',
  gmailId: 'ffffffffffffffff',
  messageId: '<message@northwind.example>'
}
function row(rating = 'Exemplary', reviewer = 'Reviewer') {
  const r = Array.from({ length: 22 }, () => '')
  r[0] = entry.id
  r[1] = 'brand-1'
  r[2] = entry.domain
  r[4] = entry.sender
  r[6] = entry.alias
  r[7] = entry.gmailId
  r[8] = entry.messageId
  r[12] = rating
  r[13] = reviewer
  r[21] = 'observer-email-review-v1'
  return r
}
const brandHeaders = [
  'Brand ID',
  'Domain',
  'Brand rating',
  'Reviewer',
  'Review notes',
  'Collected emails',
  'Open brand emails',
  'Data issue',
  'Schema version'
]
const brandRow = (rating: unknown = 'Exemplary', reviewer = 'Reviewer') => [
  'brand-1',
  entry.domain,
  rating,
  reviewer,
  '',
  '',
  '',
  '',
  'observer-brand-review-v1'
]

describe('brand defaults with email overrides', () => {
  it('inherits a named brand rating for existing and newly collected emails', () => {
    const inherited = row('', '')
    const newer = [...inherited]
    newer[0] = 'email-new'
    expect(
      selectedObserverRows(
        [headers, inherited, newer],
        [brandHeaders, brandRow()]
      )
    ).toEqual([entry, { ...entry, id: 'email-new' }])
  })
  it('lets explicit ratings override either direction, without borrowing the brand reviewer', () => {
    for (const rating of [
      'Good',
      'Unreviewed',
      'Needs improvement',
      'Unusable',
      'exemplary',
      '3/5'
    ])
      expect(
        selectedObserverRows([headers, row(rating)], [brandHeaders, brandRow()])
      ).toEqual([])
    const invalid = row()
    ;(invalid as unknown[])[12] = 46086
    expect(
      selectedObserverRows([headers, invalid], [brandHeaders, brandRow()])
    ).toEqual([])
    expect(
      selectedObserverRows(
        [headers, row('Exemplary', '')],
        [brandHeaders, brandRow()]
      )
    ).toEqual([])
    expect(
      selectedObserverRows([headers, row()], [brandHeaders, brandRow('Good')])
    ).toEqual([entry])
  })
  it('withdraws inherited approvals on downgrade/deletion, preserving explicit Exemplary', () => {
    expect(
      selectedObserverRows(
        [headers, row('', '')],
        [brandHeaders, brandRow('Good')]
      )
    ).toEqual([])
    expect(
      selectedObserverRows([headers, row('', '')], [brandHeaders])
    ).toEqual([])
    expect(selectedObserverRows([headers, row()], [brandHeaders])).toEqual([
      entry
    ])
  })
  it('rejects unnamed, mismatched, duplicate and malformed brand defaults', () => {
    const other = brandRow()
    other[1] = 'other.example'
    const schema = brandRow()
    schema[8] = 'old'
    for (const rows of [
      [brandRow('Exemplary', '')],
      [other],
      [schema],
      [brandRow(), brandRow()]
    ])
      expect(
        selectedObserverRows([headers, row('', '')], [brandHeaders, ...rows])
      ).toEqual([])
    expect(() => selectedObserverRows([headers, row('', '')], [[]])).toThrow(
      'observer_sheet_unavailable'
    )
  })
  it('excludes identified confirmations and transactionals even for an approved brand', () => {
    for (const type of ['confirmation', 'transactional', 'Transactional']) {
      const email = row('', '')
      email[11] = type
      expect(
        selectedObserverRows([headers, email], [brandHeaders, brandRow()])
      ).toEqual([])
    }
  })
})

describe('Observer human selection', () => {
  it('normalizes a legacy display-name sender without weakening human approval', () => {
    const legacy = row()
    legacy[4] = 'Northwind News <NEWS@northwind.example>'
    expect(selectedObserverRows([headers, legacy])).toEqual([entry])
    legacy[12] = 'Good'
    expect(selectedObserverRows([headers, legacy])).toEqual([])
    legacy[12] = 'Exemplary'
    legacy[13] = ''
    expect(selectedObserverRows([headers, legacy])).toEqual([])
  })
  it.each(['', 'Northwind News', 'not-an-address'])(
    'rejects an unusable sender %j before Gmail lookup',
    (sender) => {
      const invalid = row()
      invalid[4] = sender
      expect(selectedObserverRows([headers, invalid])).toEqual([])
    }
  )
  it('requires exact Exemplary, a reviewer and a unique immutable ID; Good never enters', () => {
    expect(selectedObserverRows([headers, row()])).toEqual([entry])
    for (const rating of [
      'Good',
      'Unreviewed',
      'Needs improvement',
      'exemplary',
      ' Exemplary'
    ])
      expect(selectedObserverRows([headers, row(rating)])).toEqual([])
    expect(selectedObserverRows([headers, row('Exemplary', ' ')])).toEqual([])
    expect(selectedObserverRows([headers, row(), row()])).toEqual([])
    expect(() => selectedObserverRows([[], row()])).toThrow(
      'observer_sheet_unavailable'
    )
  })
  it('rejects personal mail and malformed source identity; source order does not reset its cursor', () => {
    const r = row()
    r[6] = 'personal@gmail.com'
    expect(selectedObserverRows([headers, r])).toEqual([])
    const second = { ...entry, id: 'email-2' }
    expect(selectionVersion([entry, second])).toBe(
      selectionVersion([second, entry])
    )
    expect(selectionVersion([entry])).not.toBe(
      selectionVersion([entry, second])
    )
  })
  it('configured-but-incomplete Observer mode never falls back to unfiltered Gmail or a fake inbox', () => {
    expect(inboxConfig({ OBSERVER_SOURCE: 'sheet' }).ready).toBe(false)
    expect(
      inboxConfig({
        OBSERVER_SOURCE: 'typo',
        INBOX_IMAP_USER: 'capture@gmail.com',
        INBOX_IMAP_APP_PASSWORD: 'a'.repeat(16)
      }).ready
    ).toBe(false)
    const c = inboxConfig({
      OBSERVER_SOURCE: 'sheet',
      INBOX_IMAP_USER: 'capture@gmail.com',
      INBOX_IMAP_APP_PASSWORD: 'a'.repeat(16)
    })
    expect(c).toMatchObject({ ready: false, kind: 'gmail_imap' })
  })
  it('signs a read-only Sheet request, respects grid bounds and suppresses provider errors', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    const env = {
        OBSERVER_SPREADSHEET_ID: 'sheet-test',
        OBSERVER_SHEETS_SERVICE_ACCOUNT: JSON.stringify({
          client_email: 'reader@example.iam.gserviceaccount.com',
          private_key: privateKey
        })
      },
      urls: string[] = [],
      claims: unknown[] = []
    let brandRating = 'Exemplary'
    const request = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        urls.push(String(url))
        if (String(url).includes('oauth2.')) {
          const assertion = (init?.body as URLSearchParams).get('assertion')!
          claims.push(
            JSON.parse(
              Buffer.from(assertion.split('.')[1], 'base64url').toString()
            )
          )
          return Response.json({ access_token: 'private-token' })
        }
        if (!String(url).includes('/values:batchGet'))
          return Response.json({
            sheets: [
              {
                properties: {
                  title: 'Email review',
                  gridProperties: { rowCount: 1000, columnCount: 22 }
                }
              },
              {
                properties: {
                  title: 'Brand ratings',
                  gridProperties: { rowCount: 1000, columnCount: 9 }
                }
              }
            ]
          })
        expect(decodeURIComponent(String(url))).toContain('A6:V1000')
        return Response.json({
          valueRanges: [
            { values: [headers, row('', '')] },
            { values: [brandHeaders, brandRow(brandRating)] }
          ]
        })
      }
    )
    const source = observerSelection(env, request as typeof fetch)
    expect(await source.read()).toEqual([entry])
    expect(await source.read()).toEqual([entry])
    brandRating = 'Good'
    expect(await source.read()).toEqual([])
    expect(urls.filter((u) => u.includes('fields=sheets'))).toHaveLength(1)
    expect(urls.filter((u) => u.includes('oauth2.'))).toHaveLength(1)
    expect(claims[0]).toMatchObject({
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly'
    })
    const failed = observerSelection(
      env,
      vi.fn(
        async () =>
          new Response('credentials in provider error', { status: 500 })
      ) as typeof fetch
    )
    await expect(failed.read()).rejects.toThrow('observer_sheet_unavailable')
  })
})
function fakeClient(raw: string) {
  const client = {
    on: vi.fn(),
    connect: vi.fn(async () => {}),
    list: vi.fn(async () => [
      { path: 'Archive', specialUse: '\\All' },
      { path: 'Spam', specialUse: '\\Junk' },
      { path: 'Trash', specialUse: '\\Trash' }
    ]),
    getMailboxLock: vi.fn(async (path: string) => {
      client.current = path
      return { release: vi.fn() }
    }),
    current: '',
    search: vi.fn(async () => (client.current === 'Archive' ? [71] : [])),
    fetchOne: vi.fn(async (_uid: string, query: { source?: unknown }) =>
      query.source
        ? { source: Buffer.from(raw) }
        : {
            size: Buffer.byteLength(raw),
            internalDate: new Date('2026-11-01T12:00:00Z')
          }
    ),
    logout: vi.fn(async () => {}),
    messageFlagsAdd: vi.fn()
  }
  return client
}
const mime = (to = entry.alias) =>
  `From: ${entry.sender}\r\nTo: ${to}\r\nMessage-ID: ${entry.messageId}\r\nSubject: A newsletter\r\nContent-Type: text/plain\r\n\r\nHello`
describe('Sheet-selected Gmail transport', () => {
  it('imports a legacy display-name row by Message-ID and still refuses another sender', async () => {
    const legacy = row()
    legacy[4] = 'Northwind News <NEWS@northwind.example>'
    legacy[7] = ''
    const source = { read: async () => selectedObserverRows([headers, legacy]) }
    for (const wrongSender of [false, true]) {
      const raw = wrongSender
        ? mime().replace(entry.sender, 'other@northwind.example')
        : mime()
      const client = fakeClient(raw)
      const session = await observerGmailTransport(
        { user: 'capture@gmail.com', password: 'a'.repeat(16) },
        source,
        () => client as unknown as ObserverImap
      ).open()
      await session.list({ uidValidity: null, lastUid: 0 }, 25)
      expect(client.search).toHaveBeenCalledWith(
        { gmailraw: 'rfc822msgid:' + entry.messageId },
        { uid: true }
      )
      if (wrongSender)
        await expect(session.fetchRaw(1, 10000)).rejects.toThrow(
          'observer_identity_mismatch'
        )
      else
        expect(Buffer.from(await session.fetchRaw(1, 10000)).toString()).toBe(
          raw
        )
      await session.close()
    }
  })
  it('fetches an older email approved later, using all 64 bits; never marks it read', async () => {
    const client = fakeClient(mime()),
      source = { read: vi.fn(async () => [entry]) },
      transport = observerGmailTransport(
        { user: 'capture@gmail.com', password: 'a'.repeat(16) },
        source,
        () => client as unknown as ObserverImap
      )
    const session = await transport.open(),
      listing = await session.list({ uidValidity: 7, lastUid: 9999 }, 25)
    expect(listing.messages[0].uid).toBe(1)
    expect(client.search).toHaveBeenCalledWith(
      { emailId: '18446744073709551615' },
      { uid: true }
    )
    expect(Buffer.from(await session.fetchRaw(1, 10000)).toString()).toBe(
      mime()
    )
    expect(session.captureDomain?.(1)).toBe(entry.domain)
    expect(client.getMailboxLock).toHaveBeenCalledWith('Archive', {
      readOnly: true
    })
    await session.markProcessed([1])
    expect(client.messageFlagsAdd).not.toHaveBeenCalled()
    await session.close()
  })
  it('rechecks a downgrade before MIME download, and refuses a wrong recipient', async () => {
    for (const wrongRecipient of [false, true]) {
      const client = fakeClient(
        mime(wrongRecipient ? 'someone@gmail.com' : entry.alias)
      )
      let approved = true
      const session = await observerGmailTransport(
        { user: 'capture@gmail.com', password: 'a'.repeat(16) },
        { read: async () => (approved ? [entry] : []) },
        () => client as unknown as ObserverImap
      ).open()
      await session.list({ uidValidity: null, lastUid: 0 }, 25)
      if (!wrongRecipient) approved = false
      await expect(session.fetchRaw(1, 10000)).rejects.toThrow(
        wrongRecipient
          ? 'observer_identity_mismatch'
          : 'observer_message_not_approved'
      )
      await session.close()
    }
  })
  it('skips a missing original so a deleted Gmail message cannot block all later entries', async () => {
    const client = fakeClient(mime())
    client.search.mockImplementation(async () => [])
    const session = await observerGmailTransport(
      { user: 'capture@gmail.com', password: 'a'.repeat(16) },
      { read: async () => [entry] },
      () => client as unknown as ObserverImap
    ).open()
    expect(
      (await session.list({ uidValidity: null, lastUid: 0 }, 25)).messages
    ).toEqual([])
    await session.close()
  })
})
describe('GROS display and use gates', () => {
  it('keeps only current Exemplary originals, preserving explicitly synthetic examples', async () => {
    const approved = {
        id: 'approved',
        external_id: 'msg:' + messageKey(entry.messageId, new Uint8Array())
      },
      sample = { id: 'sample', synthetic: true },
      bad = { id: 'bad' }
    expect(
      await observerAllowed([approved, sample, bad], {
        read: async () => [entry]
      })
    ).toEqual([approved, sample])
    expect(await observerAllowed([approved], { read: async () => [] })).toEqual(
      []
    )
  })
  it('uses exact ingestion provenance when an older Sheet row has only a Gmail ID', async () => {
    service.mockReturnValue({
      from: () => ({
        select: () => ({
          in: async () => ({
            data: [{ id: 'm1', transport_id: 'observer:' + entry.id }],
            error: null
          })
        })
      })
    })
    const source = { read: async () => [{ ...entry, messageId: '' }] },
      rows = [{ inbox_message_id: 'm1' }, { inbox_message_id: 'm2' }]
    expect(await observerAllowed(rows, source)).toEqual([rows[0]])
  })
  it('fails closed when the current Sheet cannot be read', async () => {
    await expect(
      observerAllowed([{ external_id: 'msg:x' }], {
        read: async () => {
          throw Error('source offline')
        }
      })
    ).rejects.toThrow('source offline')
  })
})
