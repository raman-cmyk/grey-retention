import { describe, expect, it, vi } from 'vitest'
import { brandBookBlock, maxBrandBookChars } from '@/features/agents/memory'
import {
  brandBookFrom,
  maxBookChars,
  saveBrandBook,
  withoutStrategy,
  type BrandBookContent
} from './brand-book'
import type { CatalogEntry } from './catalog/read'
import type { Finding } from './findings'
import {
  bookKey,
  checkStrategy,
  maxStrategyChars,
  needsStrategy,
  strategistAgent,
  strategistAuthor,
  strategistInput,
  strategistOutput,
  usableSentence,
  withStrategy,
  type Strategy,
  type StrategistOutput
} from './strategist'

const tenantId = '00000000-0000-4000-8000-000000000101'
const found = (topic: string, statement: string, source = 'site') =>
  ({
    topic,
    statement,
    value: {},
    source,
    evidence: { url: 'https://shop.example/p', quote: statement },
    confidence: 0.8,
    pass: 'model'
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
const realBook = (): BrandBookContent =>
  brandBookFrom({
    brandName: 'Linen & Co',
    domain: 'linen.example',
    timezone: 'America/New_York',
    currency: 'USD',
    findings: [
      found('offering', 'Sells linen clothing for warm weather.'),
      found('audience', 'Women who travel.'),
      found('tone', 'Calm and plain.'),
      found('review_theme', 'The fabric feels soft.', 'reviews')
    ],
    catalog: [
      product('Linen shirt', { bestsellerRank: 1 }),
      product('Wool scarf', { bestsellerRank: 2 }),
      product('Linen hat', {
        newArrival: true,
        launchedAt: '2026-11-10T00:00:00Z'
      })
    ],
    history: null,
    catalogStatus: { featurable: 3, live: true },
    owner: null
  })
const answer = (over: Partial<StrategistOutput> = {}): StrategistOutput => ({
  positioning: 'Light linen clothing for women who travel to warm places.',
  customers: ['Women who travel and want clothes that pack light.'],
  heroProducts: ['linen shirt', 'Linen Hat'],
  angles: ['Lead with how the fabric feels on a hot day.'],
  care: ['Say nothing about sizes until the sizing is clear.'],
  ...over
})

describe('the Brand strategist (ONB-106c)', () => {
  it('runs on the plan tier at low effort, never reads the book twice, and its schema matches its check', () => {
    expect(strategistAgent).toMatchObject({
      name: 'brand-strategist',
      purpose: 'plan',
      reasoningEffort: 'low'
    })
    expect(strategistAgent.usesBrandBook).toBeFalsy()
    const required = (
      strategistAgent.schema.definition as { required: string[] }
    ).required.sort()
    expect(required).toEqual(Object.keys(answer()).sort())
    expect(strategistOutput.safeParse(answer()).success).toBe(true)
    // The book is data inside the task, never the instructions.
    const book = realBook()
    expect(JSON.parse(strategistAgent.task(strategistInput(book)))).toEqual({
      book: JSON.parse(JSON.stringify(strategistInput(book)))
    })
    expect(strategistInput(book)).not.toHaveProperty('strategy')
  })

  it('keeps plain sentences and the book’s own product titles, and drops the rest', () => {
    const book = realBook()
    const kept = checkStrategy(
      answer({
        customers: [
          'Women who travel and want clothes that pack light.',
          'women who travel and want clothes that pack light.',
          'They love the best linen in the world.',
          'They buy two shirts at a time.',
          'Short.'
        ],
        heroProducts: ['linen shirt', 'Linen Hat', 'Silk robe', 'LINEN SHIRT'],
        angles: ['Free shipping over $50 on every order.', 'See www.x.com'],
        care: ['Never promise a guarantee.']
      }),
      book
    )
    expect(kept).toEqual({
      by: strategistAuthor,
      basedOn: bookKey(book),
      positioning: 'Light linen clothing for women who travel to warm places.',
      customers: ['Women who travel and want clothes that pack light.'],
      heroProducts: ['Linen shirt', 'Linen hat'],
      angles: [],
      care: []
    })
  })

  it('keeps nothing without a plain positioning', () => {
    const book = realBook()
    for (const positioning of [
      '',
      'The best linen brand in the world.',
      'Linen from $20.'
    ])
      expect(checkStrategy(answer({ positioning }), book)).toBeNull()
  })

  it('cuts the lists until the strategy fits, so the book still fits an agent’s block', () => {
    const book = realBook()
    const long = (n: number) =>
      Array.from(
        { length: 3 },
        (_, i) =>
          `${'Women who travel light '.repeat(n)}and want ease ${'abc'[i]}.`
      )
    const kept = checkStrategy(
      answer({ customers: long(5), angles: long(5), care: long(5) }),
      book
    )!
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(maxStrategyChars)
    expect(kept.care.length).toBeLessThan(3)
    expect(kept.positioning).toBeTruthy()
    // The book's own 7,000 and the strategy fit 8,000 without being cut.
    expect(
      maxBookChars + maxStrategyChars + ',"strategy":'.length
    ).toBeLessThanOrEqual(maxBrandBookChars)
    expect(
      brandBookBlock({ version: 1, content: withStrategy(book, kept) })
    ).not.toContain('(truncated)')
  })

  it('takes one line, no link or markup, a sensible length', () => {
    expect(usableSentence('  Lead   with\nthe fabric feel.  ')).toBe(
      'Lead with the fabric feel.'
    )
    for (const s of [
      'Go to https://x.example now.',
      'Use <b>bold</b> words here.',
      'Tiny.',
      'x'.repeat(161)
    ])
      expect(usableSentence(s)).toBeNull()
  })

  it('belongs to one version of the book’s own content', () => {
    const book = realBook()
    expect(needsStrategy(book)).toBe(true)
    const strategy = checkStrategy(answer(), book)!
    const withIt = withStrategy(book, strategy)
    expect(book).not.toHaveProperty('strategy')
    expect(needsStrategy(withIt)).toBe(false)
    // Key order (as Postgres reorders jsonb) and the strategy itself do not
    // change the key.
    const reverse = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverse)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, reverse(x)])
            )
          : v
    const reordered = reverse(withIt) as BrandBookContent
    expect(Object.keys(reordered)).not.toEqual(Object.keys(withIt))
    expect(bookKey(reordered)).toBe(bookKey(book))
    expect(withoutStrategy(withIt)).toEqual(book)
    // The readers changed the book: its strategy is stale.
    const changed: BrandBookContent = {
      ...withIt,
      products: { ...withIt.products, bestsellers: ['Wool scarf'] }
    }
    expect(needsStrategy(changed)).toBe(true)
    // Never for a sample book.
    expect(needsStrategy({ ...book, sample: true })).toBe(false)
  })
})

describe('saveBrandBook with a strategy (ONB-106c)', () => {
  const db = (latest: unknown) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: async () => latest
    }
    const rpc = vi.fn(async () => ({ data: 4, error: null }))
    return { client: { from: () => chain, rpc } as never, rpc }
  }

  it('keeps the version with the strategy while the book’s own content is the same', async () => {
    const book = realBook()
    const strategy: Strategy = checkStrategy(answer(), book)!
    const same = db({
      data: [{ content: withStrategy(book, strategy) }],
      error: null
    })
    expect(await saveBrandBook(same.client, tenantId, book)).toBeNull()
    expect(same.rpc).not.toHaveBeenCalled()
  })

  it('saves a changed book without the old strategy', async () => {
    const book = realBook()
    const old = withStrategy(
      { ...book, products: { ...book.products, bestsellers: [] } },
      checkStrategy(answer(), book)!
    )
    const changed = db({ data: [{ content: old }], error: null })
    expect(await saveBrandBook(changed.client, tenantId, book)).toBe(4)
    const saved = (changed.rpc.mock.calls[0] as unknown[])[1] as {
      content: BrandBookContent
    }
    expect(saved.content).not.toHaveProperty('strategy')
  })
})
