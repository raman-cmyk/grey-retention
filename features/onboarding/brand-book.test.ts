import { describe, expect, it, vi } from 'vitest'
import {
  brandBookAuthor,
  brandBookFrom,
  maxBookChars,
  sameBook,
  saveBrandBook,
  staleBooks,
  within,
  writeBrandBook,
  type BrandBookParts
} from './brand-book'
import type { CatalogEntry } from './catalog/read'
import type { Finding } from './findings'
import { historySnapshot, windowRead } from './history/facts'
import type { StoredHistory } from './history/read'

const tenantId = '00000000-0000-4000-8000-000000000101'
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

describe('saveBrandBook (ONB-106b)', () => {
  type Answer = { data: unknown; error: unknown }
  const db = (
    latest: unknown,
    rpc = vi.fn(async (): Promise<Answer> => ({ data: 3, error: null }))
  ) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: async () => latest
    }
    return { client: { from: () => chain, rpc } as never, rpc }
  }
  const book = brandBookFrom(parts())

  it('saves a new version only when the book changed, whatever its keys’ order', async () => {
    const reordered = JSON.parse(JSON.stringify(book, Object.keys(book).sort()))
    expect(sameBook(book, { ...reordered, ...book })).toBe(true)
    const same = db({ data: [{ content: { ...book } }], error: null })
    expect(await saveBrandBook(same.client, tenantId, book)).toBeNull()
    expect(same.rpc).not.toHaveBeenCalled()
    const changed = db({
      data: [{ content: { ...book, sample: true } }],
      error: null
    })
    expect(await saveBrandBook(changed.client, tenantId, book)).toBe(3)
    expect(changed.rpc).toHaveBeenCalledWith('save_brand_book', {
      t: tenantId,
      content: book,
      written_by: brandBookAuthor
    })
  })

  it('throws when a read or the save fails', async () => {
    await expect(
      saveBrandBook(
        db({ data: null, error: { code: '42501' } }).client,
        tenantId,
        book
      )
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      saveBrandBook(
        db(
          { data: [], error: null },
          vi.fn(async (): Promise<Answer> => ({
            data: null,
            error: { code: 'PT409' }
          }))
        ).client,
        tenantId,
        book
      )
    ).rejects.toMatchObject({ code: 'PT409' })
  })
})

describe('writeBrandBook (ONB-106b)', () => {
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
    timezone: vi.fn(async () => 'America/New_York')
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

  it('reads only this workspace and saves its book', async () => {
    const { db, eqs, rpc } = client({
      profile,
      status: { currency: 'USD', featurable: 3, live: true }
    })
    const r = reads()
    expect(await writeBrandBook(db, tenantId, r)).toBe(1)
    for (const read of Object.values(r))
      expect(read).toHaveBeenCalledWith(db, tenantId)
    expect(eqs).toEqual([
      ['brand_profiles', 'tenant_id', tenantId],
      ['catalog_status', 'tenant_id', tenantId],
      ['brand_books', 'tenant_id', tenantId]
    ])
    const saved = rpc.mock.calls[0]![1] as { content: { owner: unknown } }
    expect(saved.content.owner).toEqual({
      positioning: 'Linen.',
      voice: 'Warm.',
      prohibitions: 'Never cheap.'
    })
  })

  it('never saves a sample book for a real brand, and an unapproved profile is not confirmed', async () => {
    const sampleReads = {
      ...reads(),
      findings: vi.fn(async () => [
        found('tone', 'Sample.', { pass: 'sample' })
      ]),
      history: vi.fn(async () => null)
    }
    const real = client({ profile, status: null })
    expect(await writeBrandBook(real.db, tenantId, sampleReads)).toBeNull()
    expect(real.rpc).not.toHaveBeenCalled()
    const synthetic = client({
      profile: { ...profile, synthetic: true, approved_revision: 1 },
      status: null
    })
    expect(await writeBrandBook(synthetic.db, tenantId, sampleReads)).toBe(1)
    const saved = synthetic.rpc.mock.calls[0]![1] as {
      content: { owner: unknown; sample: boolean }
    }
    expect(saved.content).toMatchObject({ owner: null, sample: true })
  })

  it('throws when the profile or the catalog read fails', async () => {
    for (const table of ['brand_profiles', 'catalog_status'])
      await expect(
        writeBrandBook(client({ error: table }).db, tenantId, reads())
      ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('staleBooks and within (ONB-106b)', () => {
  function client(reads: unknown[], books: unknown[]) {
    const db = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          in: () => chain,
          eq: () => chain,
          gte: () => chain,
          order: () => chain,
          limit: async () => ({
            data: table === 'job_runs' ? reads : books,
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

  it('waits for a write at most so long', async () => {
    await expect(within(Promise.resolve(1), 50)).resolves.toBe(1)
    await expect(within(new Promise(() => {}), 10)).rejects.toMatchObject({
      code: 'brand_book_timeout'
    })
  })
})
