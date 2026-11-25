import { describe, expect, it, vi } from 'vitest'
import { brandBookHeader } from '@/features/agents/memory'
import {
  brandBookAuthor,
  brandBookFrom,
  changedBook,
  composeBrandBook,
  maxBookChars,
  sameBook,
  staleBooks,
  strategistAuthor,
  within,
  withCorrections,
  type BrandBookParts
} from './brand-book'
import type { Correction } from './brand-book-corrections'
import type { CatalogEntry } from './catalog/read'
import type { Finding } from './findings'
import { historySnapshot, windowRead } from './history/facts'
import type { StoredHistory } from './history/read'

const tenantId = '00000000-0000-4000-8000-000000000101'
let c = 0
const correction = (over: Partial<Correction>): Correction => ({
  id: `c${++c}`,
  section: 'voice',
  original: null,
  action: 'add',
  value: null,
  createdAt: '2026-11-15T10:00:00Z',
  ...over
})
const found = (
  topic: string,
  statement: string,
  over: Record<string, unknown> = {}
) =>
  ({
    topic,
    statement,
    value: {},
    source: 'site',
    evidence: { url: 'https://shop.example/p', quote: statement },
    confidence: 0.8,
    pass: 'model',
    ...over
  }) as unknown as Finding
const returns = (days: number, page: string, pass = 'model') =>
  ({
    ...found('returns', `Returns within ${days} days.`),
    pass,
    value: { days },
    evidence: {
      url: `https://shop.example/${page}`,
      quote: `Returns within ${days} days.`,
      page
    }
  }) as unknown as Finding
const product = (title: string, over: Partial<CatalogEntry> = {}) =>
  ({
    id: title,
    title,
    featurable: true,
    bestsellerRank: null,
    newArrival: false,
    launchedAt: null,
    ...over
  }) as CatalogEntry
const history = (over: Partial<StoredHistory> = {}): StoredHistory => ({
  history: historySnapshot.parse({
    currency: 'USD',
    timezone: 'America/New_York',
    sendsPerWeek: 2.5,
    usualSendTime: '09:00',
    sent: [],
    scheduled: [],
    flows: [],
    audiences: [
      {
        id: 'A',
        kind: 'segment',
        name: 'Engaged',
        active: true,
        starred: true,
        excludedOnly: false
      },
      {
        id: 'B',
        kind: 'list',
        name: 'Suppressed',
        active: true,
        starred: false,
        excludedOnly: true
      }
    ],
    flowsRead: true,
    window: windowRead,
    parts: {
      sent: true,
      scheduled: true,
      audiences: true,
      campaignReport: true,
      flows: true,
      flowReport: true,
      lists: true,
      segments: true
    }
  }),
  state: 'ready',
  reason: null,
  readAt: '2026-11-15T00:00:00Z',
  complete: true,
  live: true,
  ...over
})
const parts = (over: Partial<BrandBookParts> = {}): BrandBookParts => ({
  brandName: 'Linen & Co',
  domain: 'linen.example',
  timezone: 'America/New_York',
  currency: 'USD',
  findings: [
    found('offering', 'Sells linen clothing for warm weather.', {
      confidence: 0.9
    }),
    found('audience', 'Women who travel.'),
    found('tone', 'Calm and plain.'),
    found('review_theme', 'The fabric feels soft.', { source: 'reviews' }),
    found('objection', 'Sizes run small.', { source: 'reviews' }),
    found('angle', 'Ads show linen at the beach.', { source: 'ads' }),
    found('promotion', 'A live ad offers a free gift.', { source: 'ads' }),
    returns(30, 'returns')
  ],
  catalog: [
    product('Wool scarf', { bestsellerRank: 2 }),
    product('Linen shirt', {
      bestsellerRank: 1,
      newArrival: true,
      launchedAt: '2026-11-01T00:00:00Z'
    }),
    product('Linen hat', {
      newArrival: true,
      launchedAt: '2026-11-10T00:00:00Z'
    }),
    product('Draft hat', { featurable: false, bestsellerRank: 3 })
  ],
  history: history(),
  catalogStatus: { featurable: 1200, live: true },
  owner: null,
  ...over
})

describe('brandBookFrom (ONB-106b)', () => {
  it('keeps the confirmed facts apart from what the readers observed', () => {
    const book = brandBookFrom(parts())
    expect(book).toMatchObject({
      schema: 2,
      sample: false,
      brand: {
        name: 'Linen & Co',
        site: 'https://linen.example',
        industry: 'apparel',
        currency: 'USD'
      },
      facts: { returnDays: 30, freeShipping: null, reviewsVerified: false },
      owner: null,
      unclear: [],
      observed: {
        offering: ['Sells linen clothing for warm weather.'],
        customers: {
          who: ['Women who travel.'],
          love: ['The fabric feels soft.'],
          worries: ['Sizes run small.']
        },
        voice: ['Calm and plain.'],
        marketing: ['Ads show linen at the beach.'],
        sending: {
          sendsPerWeek: 2.5,
          usualSendTime: '09:00',
          audiences: ['Engaged']
        }
      },
      products: {
        count: 1200,
        bestsellers: ['Linen shirt', 'Wool scarf'],
        newArrivals: ['Linen hat', 'Linen shirt']
      },
      sources: ['ads', 'reviews', 'site']
    })
    expect(book.avoid.length).toBeGreaterThan(0)
    // The agents' header names the book's parts exactly (features/agents/memory.ts).
    const header = brandBookHeader(2)
    for (const part of ['facts', 'owner', 'observed', 'unclear', 'avoid']) {
      expect(Object.keys(book)).toContain(part)
      expect(header).toContain(`"${part}"`)
    }
    // UI-BRAND-2: the parts the owner corrected come before the reading.
    expect(header).toMatch(
      /"corrected" names parts the owner corrected: his words there outrank "strategy"/
    )
  })

  it('never takes a dated ad offer, or a sentence with a number or a claim', () => {
    const book = brandBookFrom(
      parts({
        findings: [
          found(
            'offering',
            'Sells the softest organic linen, loved by thousands.'
          ),
          found('offering', 'Sells linen shirts.'),
          found('tone', 'Ships in 2 days.')
        ]
      })
    )
    expect(book.observed.offering).toEqual(['Sells linen shirts.'])
    expect(book.observed.voice).toEqual([])
    expect(JSON.stringify(brandBookFrom(parts()))).not.toContain('free gift')
  })

  it('names what the sources disagree on, never their sentences', () => {
    const book = brandBookFrom(
      parts({ findings: [returns(30, 'returns'), returns(0, 'product')] })
    )
    expect(book.facts.returnDays).toBeNull()
    expect(book.unclear).toEqual([
      { topic: 'returns', rule: 'Sources disagree: make no claim about it.' }
    ])
    expect(JSON.stringify(book.unclear)).not.toContain('30')
  })

  it('takes the owner’s approved profile as confirmed', () => {
    const owner = {
      positioning: 'Linen for slow travel.',
      voice: 'Warm, short sentences.',
      prohibitions: 'Never say cheap.'
    }
    expect(brandBookFrom(parts({ owner })).owner).toEqual(owner)
  })

  it('gives the same book whatever order the findings come in', () => {
    const tied = [
      found('tone', 'Warm.', { confidence: 0.7 }),
      found('tone', 'Plain.', { confidence: 0.7, source: 'social' }),
      found('tone', 'Bold.', { confidence: 0.7 }),
      found('tone', 'Quiet.', { confidence: 0.7 }),
      found('offering', 'Dog treats.', { confidence: 0.7 }),
      found('offering', 'Skincare serums.', { confidence: 0.7 })
    ]
    const a = brandBookFrom(parts({ findings: tied }))
    const b = brandBookFrom(parts({ findings: [...tied].reverse() }))
    expect(sameBook(a, b)).toBe(true)
    expect(a.observed.voice).toEqual(['Bold.', 'Quiet.', 'Warm.'])
  })

  it('stays within its size, dropping the least needed lines first', () => {
    const long = (topic: string, i: number) =>
      found(
        topic,
        `${'Soft linen shirts and dresses for slow travel by the sea '.repeat(5)}${['alpha', 'beta', 'gamma'][i]}.`,
        {
          confidence: 0.9 - i / 100
        }
      )
    const topics = [
      'offering',
      'audience',
      'review_theme',
      'objection',
      'tone',
      'angle'
    ]
    const book = brandBookFrom(
      parts({
        findings: topics.flatMap((t) => [0, 1, 2].map((i) => long(t, i))),
        catalog: Array.from({ length: 20 }, (_, i) =>
          product(`${'Long product title '.repeat(5)}${i}`, {
            bestsellerRank: i + 1,
            newArrival: true
          })
        )
      })
    )
    expect(JSON.stringify(book).length).toBeLessThanOrEqual(maxBookChars)
    expect(book.observed.offering.length).toBeGreaterThan(0)
    expect(book.observed.marketing).toEqual([])
  })

  it('is real when any reader read the brand’s own data, else sample', () => {
    const sampleSite = [found('tone', 'Sample tone.', { pass: 'sample' })]
    const sample = brandBookFrom(
      parts({
        findings: sampleSite,
        history: history({ live: false }),
        catalogStatus: { featurable: 2, live: false }
      })
    )
    expect(sample.sample).toBe(true)
    expect(sample.observed.voice).toEqual(['Sample tone.'])
    // A live catalog alone makes it real: the sample site's lines are left out.
    const real = brandBookFrom(
      parts({
        findings: [...sampleSite, returns(30, 'returns', 'sample')],
        history: null,
        catalogStatus: { featurable: 2, live: true }
      })
    )
    expect(real.sample).toBe(false)
    expect(real.observed.voice).toEqual([])
    expect(real.facts.returnDays).toBeNull()
    // A code finding from a live read counts too.
    expect(
      brandBookFrom(
        parts({
          findings: [found('tone', 'Plain.', { pass: 'code' })],
          history: null,
          catalogStatus: null
        })
      ).sample
    ).toBe(false)
  })

  it('takes the sending habits only from a full read, and fills gaps safely', () => {
    expect(
      brandBookFrom(parts({ history: history({ complete: false }) })).observed
        .sending
    ).toBeNull()
    const book = brandBookFrom(
      parts({
        brandName: '  ',
        domain: 'not a domain',
        findings: [],
        catalog: [],
        history: null,
        catalogStatus: null
      })
    )
    expect(book).toMatchObject({
      brand: { name: null, site: null, industry: 'other' },
      products: { count: 0, bestsellers: [], newArrivals: [] },
      observed: { sending: null },
      sources: []
    })
  })
})

describe('changedBook (ONB-106b; UI-BRAND-2: the rewrite job saves it)', () => {
  const book = brandBookFrom(parts())

  it('gives the book to save only when it changed, whatever its keys’ order', () => {
    const reordered = JSON.parse(JSON.stringify(book, Object.keys(book).sort()))
    expect(sameBook(book, { ...reordered, ...book })).toBe(true)
    expect(changedBook({ ...book }, book)).toBeNull()
    expect(changedBook({ ...book, sample: true }, book)).toEqual(book)
    // No book yet: the first one is saved.
    expect(changedBook(undefined, book)).toEqual(book)
    expect(changedBook(null, book)).toEqual(book)
  })
})

describe('composeBrandBook (ONB-106b)', () => {
  function client(
    rows: { profile?: unknown; status?: unknown; error?: string } = {}
  ) {
    const eqs: [string, string, unknown][] = []
    const rpc = vi.fn<
      (name: string, args: unknown) => Promise<{ data: number; error: null }>
    >(async () => ({ data: 1, error: null }))
    const db = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: (c: string, v: unknown) => (eqs.push([table, c, v]), chain),
          order: () => chain,
          limit: async () => ({ data: [], error: null }),
          maybeSingle: async () =>
            rows.error === table
              ? { data: null, error: { code: '42501' } }
              : {
                  data:
                    table === 'brand_profiles'
                      ? (rows.profile ?? null)
                      : (rows.status ?? null),
                  error: null
                }
        }
        return chain
      },
      rpc
    } as never
    return { db, eqs, rpc }
  }
  const reads = () => ({
    findings: vi.fn(async () => parts().findings as Finding[]),
    catalog: vi.fn(async () => parts().catalog as CatalogEntry[]),
    history: vi.fn(async () => history()),
    timezone: vi.fn(async () => 'America/New_York'),
    corrections: vi.fn(async () => [] as Correction[])
  })
  const profile = {
    brand_name: 'Linen & Co',
    domain: 'linen.example',
    synthetic: false,
    voice: 'Warm.',
    positioning: 'Linen.',
    prohibitions: 'Never cheap.',
    revision: 2,
    approved_revision: 2
  }

  it('reads only this workspace and writes its book, saving nothing', async () => {
    const { db, eqs, rpc } = client({
      profile,
      status: { currency: 'USD', featurable: 3, live: true }
    })
    const r = reads()
    const saved = await composeBrandBook(db, tenantId, r)
    for (const read of Object.values(r))
      expect(read).toHaveBeenCalledWith(db, tenantId)
    expect(eqs).toEqual([
      ['brand_profiles', 'tenant_id', tenantId],
      ['catalog_status', 'tenant_id', tenantId]
    ])
    expect(rpc).not.toHaveBeenCalled()
    expect(saved!.owner).toEqual({
      positioning: 'Linen.',
      voice: 'Warm.',
      prohibitions: 'Never cheap.'
    })
  })

  it('writes the book with the owner’s corrections (ONB-058)', async () => {
    const { db } = client({
      profile,
      status: { currency: 'USD', featurable: 3, live: true }
    })
    const r = {
      ...reads(),
      corrections: vi.fn(async () => [
        correction({
          section: 'voice',
          original: 'calm and  plain.',
          action: 'replace',
          value: 'Warm and witty.'
        }),
        correction({
          section: 'facts.returnDays',
          action: 'replace',
          value: '60'
        }),
        correction({
          section: 'offering',
          action: 'add',
          value: 'Made in Portugal.'
        })
      ])
    }
    const content = await composeBrandBook(db, tenantId, r)
    expect(r.corrections).toHaveBeenCalledWith(db, tenantId)
    const saved = { content: content! }
    expect(saved.content.observed.voice).toEqual(['Warm and witty.'])
    expect(saved.content.facts.returnDays).toBe(60)
    expect(saved.content).toMatchObject({
      corrected: ['facts.returnDays', 'offering', 'voice'],
      observed: { offering: expect.arrayContaining(['Made in Portugal.']) }
    })
  })

  it('never writes a sample book for a real brand, and an unapproved profile is not confirmed', async () => {
    const sampleReads = {
      ...reads(),
      findings: vi.fn(async () => [
        found('tone', 'Sample.', { pass: 'sample' })
      ]),
      history: vi.fn(async () => null)
    }
    const real = client({ profile, status: null })
    expect(await composeBrandBook(real.db, tenantId, sampleReads)).toBeNull()
    // Not even with his corrections.
    expect(
      await composeBrandBook(real.db, tenantId, {
        ...sampleReads,
        corrections: vi.fn(async () => [
          correction({ section: 'voice', action: 'add', value: 'Warm.' })
        ])
      })
    ).toBeNull()
    expect(real.rpc).not.toHaveBeenCalled()
    const synthetic = client({
      profile: { ...profile, synthetic: true, approved_revision: 1 },
      status: null
    })
    expect(
      await composeBrandBook(synthetic.db, tenantId, sampleReads)
    ).toMatchObject({ owner: null, sample: true })
  })

  it('throws when the profile, the catalog or the corrections read fails', async () => {
    for (const table of ['brand_profiles', 'catalog_status'])
      await expect(
        composeBrandBook(client({ error: table }).db, tenantId, reads())
      ).rejects.toMatchObject({ code: '42501' })
    const r = {
      ...reads(),
      corrections: vi.fn(async () => Promise.reject({ code: 'PGRST000' }))
    }
    const { db, rpc } = client({ profile })
    await expect(composeBrandBook(db, tenantId, r)).rejects.toMatchObject({
      code: 'PGRST000'
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('withCorrections (ONB-058)', () => {
  it('leaves a book he never corrected, or whose lines are gone, as it is', () => {
    const book = brandBookFrom(parts())
    const given = structuredClone(book)
    expect(withCorrections(book, [])).toEqual(given)
    const none = withCorrections(book, [
      correction({
        section: 'voice',
        original: 'A line no reader found.',
        action: 'remove'
      })
    ])
    expect(none).toEqual(given)
    expect(none).not.toHaveProperty('corrected')
    // The same corrections give the same book (no new version each run).
    const fix = [
      correction({ section: 'voice', action: 'add', value: 'Warm.' })
    ]
    expect(withCorrections(book, fix)).toEqual(withCorrections(book, fix))
    expect(book).toEqual(given)
  })

  it('makes his fact the confirmed one and takes it out of unclear', () => {
    const book = brandBookFrom(
      parts({ findings: [returns(30, 'returns'), returns(0, 'product')] })
    )
    expect(book.unclear.map((u) => u.topic)).toEqual(['returns'])
    const own = withCorrections(book, [
      correction({
        section: 'facts.returnDays',
        action: 'replace',
        value: '30'
      })
    ])
    expect(own.facts.returnDays).toBe(30)
    expect(own.unclear).toEqual([])
    expect(own.corrected).toEqual(['facts.returnDays'])
    // The book given is not changed.
    expect(book.facts.returnDays).toBeNull()
  })

  it('applies his correction to a line before the book is cut, so his words stay', () => {
    const long = (n: number) => `${'Reader line about linen '.repeat(10)}${n}.`
    // A book read too long for its size: the last line would be cut first.
    const book = structuredClone(brandBookFrom(parts()))
    book.observed.marketing = Array.from({ length: 60 }, (_, i) => long(i))
    const own = withCorrections(book, [
      correction({
        section: 'marketing',
        original: long(59),
        action: 'replace',
        value: 'His own words about his ads.'
      })
    ])
    expect(JSON.stringify(own).length).toBeLessThanOrEqual(maxBookChars)
    expect(own.observed.marketing).toContain('His own words about his ads.')
    expect(own.corrected).toEqual(['marketing'])
  })

  it('cuts the readers’ lines in every section, and their audience names, before his own', () => {
    const long = (n: number) => `${'Reader line about linen '.repeat(10)}${n}.`
    const book = structuredClone(brandBookFrom(parts()))
    book.observed.marketing = Array.from({ length: 30 }, (_, i) => long(i))
    book.observed.voice = Array.from({ length: 30 }, (_, i) => long(i))
    book.observed.sending = {
      sendsPerWeek: 2,
      usualSendTime: '09:00',
      audiences: Array.from({ length: 40 }, (_, i) => `Audience ${i}`)
    }
    const mine = 'Calm and plain, always.'
    const own = withCorrections(book, [
      correction({ section: 'voice', action: 'add', value: mine }),
      // The same words as a reader's line in another section are not his.
      correction({ section: 'voice', action: 'add', value: long(3) })
    ])
    expect(JSON.stringify(own).length).toBeLessThanOrEqual(maxBookChars)
    expect(own.observed.voice).toContain(mine)
    expect(own.observed.marketing).not.toContain(long(3))
  })

  it('cuts the readers’ lines before his own when the book is too long', () => {
    const long = (n: number) => `${'Reader line about linen '.repeat(10)}${n}.`
    const book = brandBookFrom(parts())
    book.observed.marketing = Array.from({ length: 60 }, (_, i) => long(i))
    const mine = 'Our ads show real customers at home.'
    const own = withCorrections(book, [
      correction({ section: 'marketing', action: 'add', value: mine })
    ])
    expect(JSON.stringify(own).length).toBeLessThanOrEqual(maxBookChars)
    expect(own.observed.marketing).toContain(mine)
    expect(own.observed.marketing.length).toBeLessThan(61)
  })
})

describe('staleBooks and within (ONB-106b)', () => {
  function client(
    reads: unknown[],
    books: unknown[],
    corrections: { made?: unknown[]; withdrawn?: unknown[] } = {}
  ) {
    const db = {
      from: (table: string) => {
        let cols = ''
        const chain = {
          select: (c: string) => ((cols = c), chain),
          in: () => chain,
          eq: () => chain,
          gte: () => chain,
          order: () => chain,
          limit: async () => ({
            data:
              table === 'job_runs'
                ? reads
                : table === 'brand_book_corrections'
                  ? cols.includes('withdrawn_at')
                    ? (corrections.withdrawn ?? [])
                    : (corrections.made ?? [])
                  : books,
            error: null
          })
        }
        return chain
      }
    } as never
    return db
  }

  it('finds the workspaces whose book is older than their newest read', async () => {
    const db = client(
      [
        { tenant_id: 'a', updated_at: '2026-11-15T10:00:00Z' },
        { tenant_id: 'b', updated_at: '2026-11-15T09:00:00Z' },
        { tenant_id: 'a', updated_at: '2026-11-15T08:00:00Z' },
        { tenant_id: 'c', updated_at: '2026-11-15T07:00:00Z' }
      ],
      [
        { tenant_id: 'a', created_at: '2026-11-15T09:30:00Z' },
        { tenant_id: 'b', created_at: '2026-11-15T09:30:00Z' }
      ]
    )
    expect(await staleBooks(db, { since: '2026-11-13T00:00:00Z' })).toEqual([
      'a',
      'c'
    ])
    expect(await staleBooks(client([], []), { since: 'x' })).toEqual([])
  })

  it('never counts the Brand strategist’s version as up to date: it carries the book it read (ONB-106c)', async () => {
    const db = client(
      [{ tenant_id: 'a', updated_at: '2026-11-15T10:00:00Z' }],
      [
        // The strategist saved after the read, on the older book's content.
        {
          tenant_id: 'a',
          created_at: '2026-11-15T10:05:00Z',
          written_by: strategistAuthor
        },
        {
          tenant_id: 'a',
          created_at: '2026-11-15T09:00:00Z',
          written_by: brandBookAuthor
        }
      ]
    )
    expect(await staleBooks(db, { since: '2026-11-13T00:00:00Z' })).toEqual([
      'a'
    ])
  })

  it('finds a book older than the owner’s newest correction, made or taken back (ONB-058)', async () => {
    const db = client(
      [],
      [
        { tenant_id: 'a', created_at: '2026-11-15T09:30:00Z' },
        { tenant_id: 'b', created_at: '2026-11-15T09:30:00Z' },
        { tenant_id: 'c', created_at: '2026-11-15T09:30:00Z' }
      ],
      {
        made: [
          { tenant_id: 'a', at: '2026-11-15T10:00:00Z' },
          { tenant_id: 'b', at: '2026-11-15T09:00:00Z' }
        ],
        withdrawn: [{ tenant_id: 'c', at: '2026-11-15T11:00:00Z' }]
      }
    )
    expect(await staleBooks(db, { since: '2026-11-13T00:00:00Z' })).toEqual([
      'c',
      'a'
    ])
  })

  it('takes the newest of a read and a correction, keeps to its limit, and throws a failed read', async () => {
    const db = client(
      [{ tenant_id: 'a', updated_at: '2026-11-15T08:00:00Z' }],
      [
        { tenant_id: 'a', created_at: '2026-11-15T09:00:00Z' },
        { tenant_id: 'b', created_at: '2026-11-15T09:00:00Z' }
      ],
      {
        made: [
          { tenant_id: 'a', at: '2026-11-15T10:00:00Z' },
          { tenant_id: 'b', at: '2026-11-15T09:30:00Z' }
        ]
      }
    )
    expect(await staleBooks(db, { since: 'x' })).toEqual(['a', 'b'])
    expect(await staleBooks(db, { since: 'x', limit: 1 })).toEqual(['a'])
    const failing = {
      from: (table: string) => {
        let cols = ''
        const chain = {
          select: (c: string) => ((cols = c), chain),
          in: () => chain,
          eq: () => chain,
          gte: () => chain,
          order: () => chain,
          limit: async () =>
            table === 'brand_book_corrections' && cols.includes('withdrawn_at')
              ? { data: null, error: { code: 'PGRST000' } }
              : { data: [], error: null }
        }
        return chain
      }
    } as never
    await expect(staleBooks(failing, { since: 'x' })).rejects.toMatchObject({
      code: 'PGRST000'
    })
  })

  it('waits for a write at most so long', async () => {
    await expect(within(Promise.resolve(1), 50)).resolves.toBe(1)
    await expect(within(new Promise(() => {}), 10)).rejects.toMatchObject({
      code: 'brand_book_timeout'
    })
  })
})
