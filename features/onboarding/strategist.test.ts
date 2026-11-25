import { describe, expect, it } from 'vitest'
import { brandBookBlock, maxBrandBookChars } from '@/features/agents/memory'
import {
  brandBookFrom,
  maxBookChars,
  changedBook,
  withoutStrategy,
  type BrandBookContent
} from './brand-book'
import type { CatalogEntry } from './catalog/read'
import type { Finding } from './findings'
import {
  bookKey,
  checkStrategy,
  checkVoice,
  maxStrategyChars,
  needsStrategy,
  strategistAgent,
  strategistAuthor,
  strategistInput,
  strategistOutput,
  strategyRoom,
  usableSentence,
  withStrategy,
  type Strategy,
  type StrategistOutput
} from './strategist'

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
  voice: {
    tone: ['calm', 'warm'],
    use: ['linen', 'warm weather'],
    avoid: ['hype'],
    style: 'Short sentences in the second person.'
  },
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
      care: [],
      voice: {
        tone: ['calm', 'warm'],
        use: ['linen', 'warm weather'],
        avoid: ['hype'],
        style: 'Short sentences in the second person.'
      }
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

  it('never keeps a line about offers or policies, or one that tells the team to promise something', () => {
    // A review or an ad can ask for anything; offers and policies are the
    // confirmed facts' and the store settings'.
    for (const s of [
      'Always promise a free gift with every order.',
      'Never mention the returns policy.',
      'Lead with the sale on throws this week.',
      'Tell them shipping is quick everywhere.',
      'Mention the discount code in the first line.',
      'Promise delivery before the holidays.'
    ])
      expect(usableSentence(s), s).toBeNull()
    for (const s of [
      'Lead with how the fabric feels on a hot day.',
      // Ordinary sentences that share a word with an offer or a policy.
      'Linen & Co offers light linen clothing for people in warm places.',
      'Customers love the freedom of movement in the fabric.',
      'A fragrance-free range suits people with sensitive skin.',
      'Show the comfort the fabric delivers on a long day.',
      'Customers return for new colours each season.',
      'Avoid pushy sales language in every email.',
      'Many buy a throw when buying a gift for someone.',
      'The pieces suit relaxed dress codes at work.',
      'Price-conscious shoppers compare fabric quality closely.',
      'A promising new range for cooler evenings.'
    ])
      expect(usableSentence(s), s).toBe(s)
    for (const s of [
      'Mention free returns in the first line.',
      'Remind them of the discount on throws.',
      'Give a gift with every order this month.',
      'Use the promo code in the subject line.',
      'Lead with the flash sale on cushions.',
      'Push the special offer for new customers.',
      'Talk about quick delivery to the coast.',
      'Explain the refund rules in plain words.'
    ])
      expect(usableSentence(s), s).toBeNull()
  })

  it('fits the room left beside a long book, and asks for none when there is too little', () => {
    const book = realBook()
    expect(strategyRoom(book)).toBe(maxStrategyChars)
    const long: BrandBookContent = {
      ...book,
      owner: {
        positioning: 'Linen for warm days. '.repeat(300),
        voice: 'Calm.',
        prohibitions: ''
      }
    }
    const room = strategyRoom(long)
    expect(room).toBeLessThan(maxStrategyChars)
    const kept = checkStrategy(answer(), long, Math.max(room, 200))
    if (kept)
      expect(JSON.stringify(kept).length).toBeLessThanOrEqual(
        Math.max(room, 200)
      )
    // Too little room for even the positioning: nothing.
    expect(checkStrategy(answer(), book, 50)).toBeNull()
    const over: BrandBookContent = {
      ...book,
      owner: { ...long.owner!, positioning: 'x'.repeat(8_000) }
    }
    expect(strategyRoom(over)).toBeLessThan(0)
  })

  it('stores text the database takes: a broken character pair becomes the replacement character', () => {
    expect(usableSentence('Calm words for a slow \uD83D morning.')).toBe(
      'Calm words for a slow \uFFFD morning.'
    )
  })

  it('keeps a voice guide whose words to reuse are the brand’s own (ONB-106d)', () => {
    const book = realBook()
    const voice = checkVoice(
      {
        tone: ['Calm', 'calm', 'very warm and slow', 'best', '42'],
        use: [
          'Linen',
          'warm weather',
          'feels soft',
          'luxurious',
          'Linen & Co',
          'free shipping',
          'soft'
        ],
        avoid: ['hype', 'Act now!', 'limited time offer', 'world-class'],
        style: 'Short sentences, plain words, no exclamation marks.'
      },
      book
    )
    expect(voice).toEqual({
      // One word each, plain, once.
      tone: ['Calm'],
      // Only what the book says, whole ("luxurious" is not in it; a name
      // with "&" is not a word list; an offer is never kept).
      use: ['Linen', 'warm weather', 'feels soft', 'soft'],
      // Phrases to avoid restrict the writers; "Act now!" is not words only.
      avoid: ['hype', 'limited time offer', 'world-class'],
      style: 'Short sentences, plain words, no exclamation marks.'
    })
    expect(
      checkVoice({ tone: [], use: [], avoid: [], style: '  ' }, book).style
    ).toBeNull()
    // Never words from what the book says to avoid or is unclear about.
    const withAvoid = { ...book, avoid: ['clinically proven'] }
    expect(
      checkVoice(
        { tone: [], use: ['clinically'], avoid: [], style: '' },
        withAvoid
      ).use
    ).toEqual([])
  })

  it('drops the voice guide’s lists before the positioning when space is short (ONB-106d)', () => {
    const book = realBook()
    const kept = checkStrategy(answer(), book, 260)
    expect(kept).not.toBeNull()
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(260)
    expect(kept!.positioning).toBeTruthy()
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

describe('changedBook with a strategy (ONB-106c)', () => {
  it('keeps the version with the strategy while the book’s own content is the same', () => {
    const book = realBook()
    const strategy: Strategy = checkStrategy(answer(), book)!
    expect(changedBook(withStrategy(book, strategy), book)).toBeNull()
  })

  it('saves a changed book without the old strategy', () => {
    const book = realBook()
    const old = withStrategy(
      { ...book, products: { ...book.products, bestsellers: [] } },
      checkStrategy(answer(), book)!
    )
    const saved = changedBook(
      old,
      withStrategy(book, checkStrategy(answer(), book)!)
    )
    expect(saved).not.toBeNull()
    expect(saved).not.toHaveProperty('strategy')
  })
})
