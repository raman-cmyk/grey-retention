import { describe, expect, it } from 'vitest'
import { allowedBlockTypes, unknownFacts } from '@/features/assembly/inputs'
import type { Correction } from './brand-book-corrections'
import type { Finding } from './findings'
import {
  maxQuote,
  reviewerName,
  storeMaterial,
  type MaterialParts
} from './store-material'

const site = 'https://shop.example'
const warm = 'Warm without being bulky, I wear it all weekend.'
const cosy = 'So cosy on cold mornings, and it washes well.'
const solid = 'The colour is lovely and the knit feels solid.'
const started = 'We started Cedar Lane in a small workshop in 2016.'
const layers =
  'We design for people who would rather buy one good layer than five quick ones.'
type Over = Record<string, unknown>
const review = (quote: string, value: Over = {}, over: Over = {}) =>
  ({
    topic: 'quotable_review',
    source: 'reviews',
    statement: 'A review an email may quote.',
    value: { author: 'Jordan Smith', url: `${site}/p/1`, rating: 5, ...value },
    evidence: { url: `${site}/p/1`, quote },
    confidence: 0.9,
    pass: 'code',
    ...over
  }) as unknown as Finding
const about = (quote: string, over: Over = {}, page = 'about') =>
  ({
    topic: 'offering',
    source: 'site',
    statement: `It says: ${quote.slice(0, 40)}`,
    value: {},
    evidence: { url: `${site}/pages/about`, quote, page },
    confidence: 0.8,
    pass: 'model',
    ...over
  }) as unknown as Finding
const verified = {
  topic: 'review_platform',
  source: 'reviews',
  value: { name: 'Judge.me', verified: true }
} as unknown as Finding
const parts = (over: Partial<MaterialParts> = {}): MaterialParts => ({
  brandName: 'Cedar Lane',
  host: 'shop.example',
  live: true,
  findings: [],
  corrections: [],
  facts: { ...unknownFacts, reviewsVerified: true },
  productNames: ['Weekend Knit'],
  ...over
})
const material = (findings: Finding[], over: Partial<MaterialParts> = {}) =>
  storeMaterial(parts({ findings, ...over }))

describe('reviewerName (REL-ONB2)', () => {
  it.each([
    ['Jordan Smith', 'Jordan S.'],
    ['  Jordan   smith ', 'Jordan S.'],
    ['Jordan S.', 'Jordan S.'],
    ['jordan', 'jordan'],
    ['Mary Ann O’Neil', 'Mary O.'],
    ['J. Smith', 'J. S.'],
    ['Dr. Jane Smith', 'Jane S.'],
    ['Mrs Ann Lee', 'Ann L.'],
    ['Zoë Ångström', 'Zoë Å.']
  ])('names %j as %j', (author, shown) => {
    expect(reviewerName(author)).toBe(shown)
  })
  it.each([
    '',
    'Dr.',
    'Verified Buyer',
    'Store Customer',
    'user123',
    'jo@example.com',
    '@jordan',
    'Jordan & Sam',
    'One Two Three Four Five',
    'Abcdefghijklmnopqrstuvwxyzabcdefg'
  ])('names no one for %j', (author) => {
    expect(reviewerName(author)).toBeNull()
  })
})

describe('storeMaterial (REL-ONB2 part a)', () => {
  it('allows each material block exactly when its material is there', () => {
    const allowed = (confirmed: ReturnType<typeof storeMaterial>) =>
      allowedBlockTypes({
        brief: { campaignType: 'story', goal: 'Our story' },
        products: [],
        codes: [],
        maxDiscountPercent: 0,
        sendAt: '2026-12-01T10:00:00Z',
        timezone: 'UTC',
        facts: { ...unknownFacts, reviewsVerified: true },
        confirmed
      })
    const none = material([])
    expect(none).toBeUndefined()
    for (const type of ['review_strip', 'founder_note', 'ugc_grid'])
      expect(allowed(none)).not.toContain(type)
    const both = allowed(material([verified, review(warm), about(started)]))
    expect(both).toEqual(
      expect.arrayContaining(['review_strip', 'founder_note'])
    )
    // No customer photos: no reader keeps any.
    expect(both).not.toContain('ugc_grid')
    expect(both).not.toContain('hero_image')
  })

  it('quotes the reviews word for word with their own stars, best and newest first, at most 3, each once, by first name and initial', () => {
    const got = material([
      verified,
      review(warm, { rating: 4, date: '2026-10-01' }),
      review(cosy, { author: 'Priya', date: '2026-09-01' }),
      review(solid, { author: 'Sam Lee', date: '2026-10-10' }),
      review('Bought a second one for my sister straight away.', {
        rating: 4,
        date: '2026-08-01'
      }),
      review(cosy, { author: 'Priya', date: '2026-09-01' })
    ])
    expect(got).toEqual({
      reviews: [
        { quote: solid, author: 'Sam L.', rating: 5 },
        { quote: cosy, author: 'Priya', rating: 5 },
        { quote: warm, author: 'Jordan S.', rating: 4 }
      ]
    })
  })

  it('carries no review while the brand has no verified review source (copy QA refuses their stars)', () => {
    expect(material([review(warm)], { facts: unknownFacts })).toBeUndefined()
  })

  it('leaves out every review it would have to change or that an email may not say', () => {
    const long = `${'Warm and soft. '.repeat(14)}Lovely.`
    expect(long.length).toBeGreaterThan(maxQuote)
    const elsewhere = { url: 'https://other.example/p/1', quote: warm }
    const left = [
      review(warm, { rating: undefined }), // no stars of its own
      review(long), // never cut
      review(warm, { author: 'Verified Buyer' }),
      review(warm, {}, { evidence: elsewhere }),
      review(warm, { author: 'Natural Sam' }), // copy QA reads the name too
      review(warm, {}, { pass: 'sample' }), // in a live workspace
      review(warm, {}, { confidence: 0.3 }),
      // What copy QA refuses, a claim, a result, the body, a code, a link.
      review('Arrived fast and free shipping too, love it.'),
      review('The best jumper I have ever owned, honestly.'),
      review('This cured my eczema in a week, amazing.'),
      review('My skin feels so much better in this wool.'),
      review('Use code SAVE20 at checkout for 20% off.'),
      review('Read more at https://blog.example now.')
    ]
    expect(material([verified, ...left])).toBeUndefined()
    // The store's own website, `www.` and subdomains aside.
    const sub = { url: 'https://reviews.shop.example/p/1', quote: warm }
    expect(
      material([verified, review(warm, {}, { evidence: sub })])?.reviews
    ).toHaveLength(1)
  })

  it('writes a note from whole sentences of the brand’s own about page, at most 2, signed with its name', () => {
    expect(
      material([
        about(started, { confidence: 0.9 }),
        about(layers),
        about('Every piece is knitted by a team of six in our studio.', {
          confidence: 0.6
        })
      ])
    ).toEqual({ founder: { name: 'Cedar Lane', note: [started, layers] } })
  })

  it('writes no note from anything but the brand’s own whole, plain sentences on its about page', () => {
    const elsewhere = {
      url: 'https://other.example/pages/about',
      quote: started,
      page: 'about'
    }
    const left = [
      about(started, {}, 'home'),
      about(started, { evidence: elsewhere }),
      about(started, { topic: 'claim', value: { subject: 'brand' } }),
      about(started, { pass: 'sample' }), // in a live workspace
      about('started in a small workshop in 2016'),
      about('Small workshop.'),
      // Not the brand's own voice, leaning on the sentence before, or a
      // line the Brand book would not show (so the owner could not fix it).
      about('Cedar Lane started in a small workshop in 2016.'),
      about('That shed is still where we make every knit.'),
      about(started, { statement: 'It started in 2016 with 3 people.' }),
      about('Our organic cotton is grown without any pesticides.'),
      about('Orders over $75 ship free to your door, always.'),
      about('We make the best knitwear in the whole country.')
    ]
    expect(material(left)).toBeUndefined()
    // No brand name: no one to sign it.
    expect(material([about(started)], { brandName: ' ' })).toBeUndefined()
  })

  it('never uses a line the owner removed or replaced in the Brand book', () => {
    const line = about(started)
    const correction = (over: Partial<Correction>): Correction => ({
      id: 'c1',
      section: 'offering',
      original: `  ${line.statement.toUpperCase()} `,
      action: 'remove',
      value: null,
      createdAt: '2026-11-15T10:00:00Z',
      ...over
    })
    for (const action of ['remove', 'replace'] as const)
      expect(
        material([line], {
          corrections: [correction({ action, value: 'Knitwear.' })]
        })
      ).toBeUndefined()
    // Another section's line, or an added one, leaves it.
    for (const c of [
      correction({ section: 'voice' }),
      correction({ action: 'add', original: null, value: 'Knitwear.' })
    ])
      expect(material([line], { corrections: [c] })?.founder).toBeDefined()
  })

  it('uses the sample rules’ findings only in a sample workspace', () => {
    const sample = [verified, review(warm, {}, { pass: 'sample' })]
    expect(material(sample, { live: false })?.reviews).toHaveLength(1)
    expect(material(sample)).toBeUndefined()
  })
})
