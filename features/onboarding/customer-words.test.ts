import { describe, expect, it } from 'vitest'
import type { BrandFacts } from '@/features/copy-qa/check'
import type { Finding } from '@/features/onboarding/findings'
import {
  customerWords,
  customerWordsData,
  customerWordsRule,
  maxCustomerWords,
  maxPhraseLength
} from './customer-words'

const facts: BrandFacts = {
  freeShipping: null,
  deliveryDays: null,
  returnDays: null,
  guaranteeDays: null,
  approvedClaims: [],
  bannedPhrases: [],
  reviewsVerified: false
}
const said = (quote: string, over: Record<string, unknown> = {}): Finding =>
  ({
    id: `f-${quote}`,
    runId: 'r1',
    topic: 'customer_words',
    source: 'reviews',
    statement: 'Customers say the fabric feels soft.',
    value: {},
    evidence: { url: 'https://shop.example/p/1', quote },
    confidence: 0.8,
    pass: 'model',
    model: 'flash',
    createdAt: '2026-11-15T00:00:00Z',
    ...over
  }) as unknown as Finding
const phrases = (
  findings: Finding[],
  options: Partial<Parameters<typeof customerWords>[1]> = {}
) =>
  customerWords(findings, { facts, live: true, ...options }).map(
    (p) => p.phrase
  )

describe('customerWords (ONB-061)', () => {
  it('picks the customers’ own short phrases, surest first', () => {
    const picked = customerWords(
      [
        said('fits true to size', { confidence: 0.6 }),
        said('“soft as butter”', { confidence: 0.9 }),
        said('a travel go-to', { source: 'social', confidence: 0.9 })
      ],
      { facts, live: true }
    )
    expect(picked).toEqual([
      {
        phrase: 'soft as butter',
        meaning: 'Customers say the fabric feels soft.',
        source: 'reviews',
        url: 'https://shop.example/p/1',
        confidence: 0.9
      },
      expect.objectContaining({ phrase: 'a travel go-to', source: 'social' }),
      expect.objectContaining({ phrase: 'fits true to size' })
    ])
  })

  it('leaves out what copy QA or the writer’s checks would refuse', () => {
    for (const quote of [
      'shipped within 24 hours',
      'delivered in 2 days',
      'fast shipping',
      'free shipping too',
      'easy returns',
      'full refund, no fuss',
      'risk-free to try',
      '5 stars from me',
      'love it 100%',
      'saw results in 2 weeks',
      'obsessed with this scent',
      'a cult favourite',
      'clinically proven formula',
      'the #1 tee'
    ])
      expect([quote, phrases([said(quote)])]).toEqual([quote, []])
  })

  it('never borrows a fact, even one the brand confirmed', () => {
    // Facts are said in the facts sheet's own words, never a customer's.
    expect(
      phrases([said('free shipping too')], {
        facts: { ...facts, freeShipping: 'always' }
      })
    ).toEqual([])
  })

  it('never lets a customer’s opinion become a brand claim', () => {
    for (const quote of [
      'my go-to for travel',
      'I wear it every day',
      'the softest tee',
      'comfiest jumper ever',
      'the most comfortable fit',
      'cleared my skin in a week',
      'cleared up the redness',
      'no more frizz',
      'changed my mornings'
    ])
      expect([quote, phrases([said(quote)])]).toEqual([quote, []])
    // An -est word that ranks nothing is fine.
    expect(phrases([said('an honest price')])).toEqual(['an honest price'])
  })

  it('never passes on a name, except the brand’s and its products’', () => {
    expect(phrases([said('thanks Sarah for the help!')])).toEqual([])
    expect(phrases([said('a gift Emma loved')])).toEqual([])
    expect(
      phrases([said('the Linen Shirt goes with everything')], {
        names: ['Linen Shirt', 'Linen & Co']
      })
    ).toEqual(['the Linen Shirt goes with everything'])
    expect(phrases([said('Soft and light')])).toEqual(['Soft and light'])
  })

  it('never passes on a banned phrase, whole words as copy QA reads them', () => {
    expect(
      phrases(
        [
          said('cheap but lovely'),
          said('Cheapness aside, lovely'),
          said('so soft')
        ],
        { facts: { ...facts, bannedPhrases: ['cheap'] } }
      )
    ).toEqual(['so soft', 'Cheapness aside, lovely'])
    // "#1" is not the number one: "bought 1 for each child" is fine.
    expect(phrases([said('bought 1 for each child')])).toEqual([
      'bought 1 for each child'
    ])
  })

  it('leaves out other topics, unsure findings, odd lengths and sample rules for a live workspace', () => {
    expect(
      phrases([
        said('love the colour', { topic: 'review_theme' }),
        said('love the colour', { source: 'site' }),
        said('so comfy', { confidence: 0.49 }),
        said('x'.repeat(maxPhraseLength + 1)),
        said('ok'),
        said('— 5/5 —'),
        said('no ref evidence', { evidence: { ref: 'r-1' } })
      ])
    ).toEqual([])
    expect(phrases([said('so comfy', { confidence: 0.5 })])).toEqual([
      'so comfy'
    ])
    expect(phrases([said('abc'), said('y'.repeat(maxPhraseLength))])).toEqual([
      'abc',
      'y'.repeat(maxPhraseLength)
    ])
    const sample = [said('so comfy', { pass: 'sample' })]
    expect(phrases(sample, { live: false })).toEqual(['so comfy'])
    expect(phrases(sample, { live: true })).toEqual([])
  })

  it('keeps each phrase once', () => {
    expect(
      phrases([
        said('so soft', { confidence: 0.7 }),
        said('So soft!', { confidence: 0.6 }),
        said('so soft and light', { confidence: 0.9 }),
        said('runs small')
      ])
    ).toEqual(['so soft and light', 'runs small'])
    // A longer, less sure phrase holding a surer one is left out.
    expect(
      phrases([
        said('runs small', { confidence: 0.9 }),
        said('runs small in the waist', { confidence: 0.6 })
      ])
    ).toEqual(['runs small'])
  })

  it('keeps the customer’s own quote marks inside the phrase', () => {
    expect(phrases([said("'til the end of time")])).toEqual([
      "'til the end of time"
    ])
    expect(phrases([said('"soft as butter"')])).toEqual(['soft as butter'])
  })

  it('passes on at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      said(`phrase number ${i}`)
    )
    const all = (max?: number) =>
      customerWords(many, { facts, live: true, max }).length
    expect(all()).toBe(maxCustomerWords)
    expect(all(3)).toBe(3)
    expect(all(Number.NaN)).toBe(maxCustomerWords)
    expect(all(50)).toBe(maxCustomerWords)
  })
})

describe('customerWordsData and customerWordsRule (ONB-061)', () => {
  it('gives the writer the phrases as data, and one fixed rule', () => {
    const words = customerWords([said('fits true to size'), said('so comfy')], {
      facts,
      live: true
    })
    expect(customerWordsData(words)).toEqual(['so comfy', 'fits true to size'])
    expect(customerWordsRule).toMatch(/never quote them/)
    expect(customerWordsRule).not.toMatch(/so comfy/)
  })
})
