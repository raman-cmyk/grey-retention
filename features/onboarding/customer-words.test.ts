import { describe, expect, it } from 'vitest'
import type { Finding } from '@/features/onboarding/findings'
import {
  customerWords,
  customerWordsBrief,
  maxCustomerWords,
  maxPhraseLength
} from './customer-words'

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
const phrases = (findings: Finding[], options = {}) =>
  customerWords(findings, options).map((p) => p.phrase)

describe('customerWords (ONB-061)', () => {
  it('picks the customers’ own short phrases, surest first', () => {
    const picked = customerWords([
      said('fits true to size', { confidence: 0.6 }),
      said('“the softest tee I own”', { confidence: 0.9 }),
      said('my go-to for travel', { source: 'social', confidence: 0.9 })
    ])
    expect(picked).toEqual([
      {
        phrase: 'the softest tee I own',
        meaning: 'Customers say the fabric feels soft.',
        source: 'reviews',
        url: 'https://shop.example/p/1',
        confidence: 0.9
      },
      expect.objectContaining({
        phrase: 'my go-to for travel',
        source: 'social'
      }),
      expect.objectContaining({ phrase: 'fits true to size' })
    ])
  })

  it('leaves out other topics, unsure findings, long quotes and sample rules for a live workspace', () => {
    expect(
      phrases([
        said('love the colour', { topic: 'review_theme' }),
        said('love the colour', { source: 'site' }),
        said('so comfy', { confidence: 0.4 }),
        said('x'.repeat(maxPhraseLength + 1)),
        said('!!'),
        said('— 5/5 —'),
        said('no ref evidence', { evidence: { ref: 'r-1' } })
      ])
    ).toEqual([])
    const sample = [said('so comfy', { pass: 'sample' })]
    expect(phrases(sample)).toEqual(['so comfy'])
    expect(phrases(sample, { live: true })).toEqual([])
  })

  it('never passes on a banned phrase or a general claim', () => {
    expect(
      phrases(
        [
          said('totally eco-friendly'),
          said('a miracle in a jar'),
          said('cheap but lovely'),
          said('Cheapest I found'),
          said('feels so soft')
        ],
        { banned: ['eco-friendly', 'cheap'] }
      )
      // Equally sure: the shorter first.
    ).toEqual(['feels so soft', 'Cheapest I found'])
  })

  it('keeps each phrase once, the surer one when one holds the other', () => {
    expect(
      phrases([
        said('so soft', { confidence: 0.7 }),
        said('So soft!', { confidence: 0.6 }),
        said('so soft and light', { confidence: 0.9 }),
        said('runs small')
      ])
    ).toEqual(['so soft and light', 'runs small'])
  })

  it('passes on at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      said(`phrase number ${i}`)
    )
    expect(customerWords(many)).toHaveLength(maxCustomerWords)
    expect(customerWords(many, { max: 3 })).toHaveLength(3)
  })
})

describe('customerWordsBrief (ONB-061)', () => {
  it('tells the writer to reuse them as the brand’s own words', () => {
    expect(customerWordsBrief([])).toBeNull()
    expect(
      customerWordsBrief(
        customerWords([said('fits true to size'), said('so comfy')])
      )
    ).toBe(
      'Words customers use about this brand: "so comfy", "fits true to size". Reuse them where they fit, as the brand\'s own words. Never present them as a quote or name a customer.'
    )
  })
})
