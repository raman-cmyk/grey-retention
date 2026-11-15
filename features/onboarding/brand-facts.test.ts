import { describe, expect, it } from 'vitest'
import type { Finding } from '@/features/onboarding/findings'
import { copyFacts, trueFacts } from './brand-facts'

const found = (
  topic: string,
  value: Record<string, unknown>,
  over: Record<string, unknown> = {}
) =>
  ({
    topic,
    value,
    source: 'site',
    statement: `${topic} statement`,
    confidence: 0.9,
    pass: 'model',
    ...over
  }) as unknown as Finding
const over = (amount: number, currency = 'USD') => ({
  kind: 'over',
  amount,
  currency
})

describe('trueFacts (ONB-106a)', () => {
  it('reads each fact from one source', () => {
    expect(
      trueFacts(
        [
          found('free_shipping', over(75)),
          found('returns', { days: 30 }),
          found('guarantee', { days: 60 }),
          found('delivery_days', { min: 2, max: 5, region: 'US' }),
          found(
            'review_platform',
            { name: 'Judge.me', verified: true },
            {
              source: 'reviews'
            }
          )
        ],
        { currency: 'USD' }
      )
    ).toEqual({
      freeShipping: { kind: 'over', amount: 75, currency: 'USD' },
      returnDays: 30,
      guaranteeDays: 60,
      deliveryDays: { min: 2, max: 5 },
      reviewsVerified: true,
      conflicts: []
    })
  })

  it('takes the stricter fact when sources disagree, and records why', () => {
    const facts = trueFacts(
      [
        found('free_shipping', over(75), {
          statement: 'Free shipping over $75.'
        }),
        found('free_shipping', over(100), {
          source: 'ads',
          statement: 'Free shipping over $100.'
        }),
        found('returns', { days: 30 }),
        found('returns', { days: 14 }),
        found('guarantee', { days: 60 }),
        found('guarantee', { days: 30 }),
        found('delivery_days', { min: 2, max: 5 }),
        found('delivery_days', { min: 3, max: 7 })
      ],
      { currency: 'USD' }
    )
    expect(facts).toMatchObject({
      freeShipping: { kind: 'over', amount: 100 },
      returnDays: 14,
      guaranteeDays: 30,
      deliveryDays: { min: 3, max: 7 }
    })
    expect(facts.conflicts.map((c) => c.topic)).toEqual([
      'free_shipping',
      'returns',
      'guarantee',
      'delivery_days'
    ])
    expect(facts.conflicts[0]!.said).toEqual([
      { source: 'site', statement: 'Free shipping over $75.' },
      { source: 'ads', statement: 'Free shipping over $100.' }
    ])
  })

  it('ranks free shipping: never, then a higher amount, then always', () => {
    const ship = (...values: Record<string, unknown>[]) =>
      trueFacts(
        values.map((v) => found('free_shipping', v)),
        { currency: 'USD' }
      ).freeShipping
    expect(ship({ kind: 'always' }, over(50))).toEqual(over(50))
    expect(ship(over(50), { kind: 'never' }, { kind: 'always' })).toEqual({
      kind: 'never'
    })
    expect(ship({ kind: 'always' }, { kind: 'always' })).toEqual({
      kind: 'always'
    })
  })

  it('says nothing about free shipping it cannot compare', () => {
    expect(
      trueFacts([
        found('free_shipping', over(75, 'USD')),
        found('free_shipping', over(50, 'EUR'))
      ]).freeShipping
    ).toBeNull()
    expect(
      trueFacts([found('free_shipping', over(50, 'EUR'))], { currency: 'USD' })
        .freeShipping
    ).toBeNull()
    expect(
      trueFacts(
        [
          found('free_shipping', over(50, 'EUR')),
          found('free_shipping', over(75))
        ],
        { currency: 'USD' }
      ).freeShipping
    ).toBeNull()
  })

  it('records no conflict when two pages say the same', () => {
    const facts = trueFacts([
      found('returns', { days: 30 }),
      found('returns', { days: 30 }, { statement: 'other page' })
    ])
    expect(facts).toMatchObject({ returnDays: 30, conflicts: [] })
  })

  it('uses only sure findings that fit their topic, never sample rules for a live workspace', () => {
    expect(
      trueFacts([
        found('returns', { days: 30 }, { confidence: 0.5 }),
        found('guarantee', { days: 'sixty' }),
        found('delivery_days', { min: 2, max: 5 }, { pass: 'sample' })
      ])
    ).toMatchObject({
      returnDays: null,
      guaranteeDays: null,
      deliveryDays: { min: 2, max: 5 }
    })
    expect(
      trueFacts(
        [found('delivery_days', { min: 2, max: 5 }, { pass: 'sample' })],
        {
          live: true
        }
      ).deliveryDays
    ).toBeNull()
  })

  it('believes reviews are real only when the reviews reader found a verified platform', () => {
    const platform = (verified: boolean, source = 'reviews') =>
      found('review_platform', { name: 'Yotpo', verified }, { source })
    expect(trueFacts([platform(false)]).reviewsVerified).toBe(false)
    expect(trueFacts([platform(true, 'site')]).reviewsVerified).toBe(false)
    expect(trueFacts([platform(false), platform(true)]).reviewsVerified).toBe(
      true
    )
    expect(trueFacts([]).reviewsVerified).toBe(false)
  })
})

describe('copyFacts (ONB-106a)', () => {
  it('hands copy QA the facts, unknowns left null', () => {
    const facts = trueFacts(
      [found('free_shipping', over(75)), found('returns', { days: 0 })],
      { currency: 'USD' }
    )
    expect(copyFacts(facts, { bannedPhrases: ['cheap'] })).toEqual({
      freeShipping: { over: 75 },
      deliveryDays: null,
      returnDays: 0,
      guaranteeDays: null,
      approvedClaims: [],
      bannedPhrases: ['cheap'],
      reviewsVerified: false
    })
    expect(
      copyFacts(trueFacts([found('free_shipping', { kind: 'always' })]))
        .freeShipping
    ).toBe('always')
    expect(copyFacts(trueFacts([])).freeShipping).toBeNull()
  })
})
