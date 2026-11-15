import { describe, expect, it, vi } from 'vitest'
import {
  brandBookAuthor,
  brandBookFrom,
  sameBook,
  saveBrandBook,
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
const product = (title: string, over: Partial<CatalogEntry> = {}) =>
  ({
    id: title,
    title,
    featurable: true,
    bestsellerRank: null,
    newArrival: false,
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
    found('promotion', 'Runs a summer sale.', { source: 'ads' }),
    {
      ...found('returns', '30-day returns.'),
      value: { days: 30 },
      evidence: {
        url: 'https://shop.example/returns',
        quote: 'Returns within 30 days.',
        page: 'returns'
      }
    } as unknown as Finding
  ],
  catalog: [
    product('Wool scarf', { bestsellerRank: 2 }),
    product('Linen shirt', { bestsellerRank: 1, newArrival: true }),
    product('Draft hat', { featurable: false, bestsellerRank: 3 })
  ],
  history: history(),
  ...over
})

describe('brandBookFrom (ONB-106b)', () => {
  it('puts together what the readers found', () => {
    const book = brandBookFrom(parts())
    expect(book).toMatchObject({
      schema: 1,
      sample: false,
      brand: {
        name: 'Linen & Co',
        site: 'https://linen.example',
        industry: 'apparel',
        timezone: 'America/New_York',
        currency: 'USD'
      },
      facts: { returnDays: 30, freeShipping: null, reviewsVerified: false },
      unclear: [],
      offering: ['Sells linen clothing for warm weather.'],
      customers: {
        who: ['Women who travel.'],
        love: ['The fabric feels soft.'],
        worries: ['Sizes run small.']
      },
      voice: ['Calm and plain.'],
      marketing: ['Runs a summer sale.'],
      products: {
        count: 2,
        bestsellers: ['Linen shirt', 'Wool scarf'],
        newArrivals: ['Linen shirt']
      },
      sending: {
        sendsPerWeek: 2.5,
        usualSendTime: '09:00',
        audiences: ['Engaged']
      },
      sources: ['ads', 'reviews', 'site']
    })
    expect(book.avoid.length).toBeGreaterThan(0)
    // Small enough for an agent's prompt.
    expect(JSON.stringify(book).length).toBeLessThan(8_000)
  })

  it('keeps what the sources disagree on out of the facts', () => {
    const page = (days: number, kind: string) =>
      ({
        ...found('returns', `${days}-day returns.`),
        value: { days },
        evidence: {
          url: `https://shop.example/${kind}`,
          quote: `Returns within ${days} days.`,
          page: kind
        }
      }) as unknown as Finding
    const book = brandBookFrom(
      parts({ findings: [page(30, 'returns'), page(0, 'product')] })
    )
    expect(book.facts.returnDays).toBeNull()
    expect(book.unclear).toEqual([
      { topic: 'returns', said: ['30-day returns.', '0-day returns.'] }
    ])
  })

  it('takes the surest few statements, each once', () => {
    const book = brandBookFrom(
      parts({
        findings: [
          found('tone', 'Warm.', { confidence: 0.7 }),
          found('tone', 'Plain.', { confidence: 0.9 }),
          found('tone', 'plain.', { confidence: 0.8 }),
          found('tone', 'Friendly.', { confidence: 0.75 }),
          found('tone', 'Bold.', { confidence: 0.72 }),
          found('tone', 'Unsure.', { confidence: 0.5 })
        ]
      })
    )
    expect(book.voice).toEqual(['Plain.', 'Friendly.', 'Bold.'])
  })

  it('says sample when it rests on sample data, and never mixes it into a live one', () => {
    const sample = brandBookFrom(
      parts({
        findings: [found('tone', 'Sample tone.', { pass: 'sample' })],
        history: history({ live: false })
      })
    )
    expect(sample.sample).toBe(true)
    expect(sample.voice).toEqual(['Sample tone.'])
    const live = brandBookFrom(
      parts({
        findings: [
          found('tone', 'Sample tone.', { pass: 'sample' }),
          found('tone', 'Real tone.')
        ]
      })
    )
    expect(live.voice).toEqual(['Real tone.'])
    expect(live.sample).toBe(false)
  })

  it('fills the gaps safely', () => {
    const book = brandBookFrom(
      parts({
        brandName: '  ',
        domain: 'not a domain',
        findings: [],
        catalog: [],
        history: null
      })
    )
    expect(book).toMatchObject({
      brand: { name: null, site: null, industry: 'other' },
      products: { count: 0, bestsellers: [], newArrivals: [] },
      sending: null,
      sources: []
    })
    expect(
      brandBookFrom(parts({ history: history({ state: 'empty' }) })).sending
    ).toBeNull()
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
      data: [{ content: { ...book, voice: ['Old.'] } }],
      error: null
    })
    expect(await saveBrandBook(changed.client, tenantId, book)).toBe(3)
    expect(changed.rpc).toHaveBeenCalledWith('save_brand_book', {
      t: tenantId,
      content: book,
      written_by: brandBookAuthor
    })
    const first = db({ data: [], error: null })
    expect(await saveBrandBook(first.client, tenantId, book)).toBe(3)
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
          vi.fn(async () => ({ data: null, error: { code: 'PT409' } }))
        ).client,
        tenantId,
        book
      )
    ).rejects.toMatchObject({ code: 'PT409' })
  })
})

describe('writeBrandBook (ONB-106b)', () => {
  it('reads only this workspace and saves its book', async () => {
    const eqs: [string, string, unknown][] = []
    const rpc = vi.fn(async () => ({ data: 1, error: null }))
    const client = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: (c: string, v: unknown) => (eqs.push([table, c, v]), chain),
          order: () => chain,
          limit: async () => ({ data: [], error: null }),
          maybeSingle: async () =>
            table === 'brand_profiles'
              ? {
                  data: { brand_name: 'Linen & Co', domain: 'linen.example' },
                  error: null
                }
              : { data: { currency: 'USD' }, error: null }
        }
        return chain
      },
      rpc
    } as never
    const reads = {
      findings: vi.fn(async () => parts().findings as Finding[]),
      catalog: vi.fn(async () => parts().catalog as CatalogEntry[]),
      history: vi.fn(async () => history()),
      timezone: vi.fn(async () => 'America/New_York')
    }
    expect(await writeBrandBook(client, tenantId, reads)).toBe(1)
    for (const r of Object.values(reads))
      expect(r).toHaveBeenCalledWith(client, tenantId)
    expect(eqs).toEqual([
      ['brand_profiles', 'tenant_id', tenantId],
      ['catalog_status', 'tenant_id', tenantId],
      ['brand_books', 'tenant_id', tenantId]
    ])
    expect(rpc).toHaveBeenCalledWith(
      'save_brand_book',
      expect.objectContaining({ t: tenantId, written_by: brandBookAuthor })
    )
  })
})
