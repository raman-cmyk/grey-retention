import { describe, expect, it } from 'vitest'
import type { Finding } from '@/features/onboarding/findings'
import { copyFacts, trueFacts } from './brand-facts'

const found = (
  topic: string,
  value: Record<string, unknown>,
  over: Record<string, unknown> = {},
  page: string | null = null
) =>
  ({
    topic,
    value,
    source: 'site',
    statement: `${topic} statement`,
    evidence: {
      url: 'https://shop.example/page',
      quote: `${topic} quote`,
      ...(page ? { page } : {})
    },
    confidence: 0.9,
    pass: 'model',
    ...over
  }) as unknown as Finding
const over = (amount: number, currency = 'USD') => ({
  kind: 'over',
  amount,
  currency
})
const usd = { live: true, currency: 'USD' }
const moneyBack = { statement: 'A 60-day money-back guarantee.' }

describe('trueFacts (ONB-106a)', () => {
  it('reads each fact from one source', () => {
    expect(
      trueFacts(
        [
          found('free_shipping', over(75), {}, 'shipping'),
          found('returns', { days: 30 }, {}, 'returns'),
          found('guarantee', { days: 60 }, moneyBack, 'faq'),
          found('delivery_days', { min: 2, max: 5 }, {}, 'shipping'),
          found(
            'review_platform',
            { name: 'Judge.me', verified: true },
            { source: 'reviews' }
          )
        ],
        usd
      )
    ).toEqual({
      freeShipping: {
        value: { kind: 'over', amount: 75, currency: 'USD' },
        conflict: false,
        fromPolicyPage: true
      },
      returnDays: { value: 30, conflict: false, fromPolicyPage: true },
      guaranteeDays: { value: 60, conflict: false, fromPolicyPage: true },
      delivery: [
        { region: null, min: 2, max: 5, businessDays: false, conflict: false }
      ],
      reviewsVerified: true,
      conflicts: []
    })
  })

  it('takes the stricter fact when pages disagree, and records which page said what', () => {
    const facts = trueFacts(
      [
        found(
          'free_shipping',
          over(75),
          { statement: 'Free shipping over $75.' },
          'shipping'
        ),
        found(
          'free_shipping',
          over(100),
          { statement: 'Free shipping over $100.' },
          'faq'
        ),
        found('returns', { days: 30 }, {}, 'returns'),
        found('returns', { days: 14 }, {}, 'faq'),
        found('delivery_days', { min: 2, max: 5 }),
        found('delivery_days', { min: 3, max: 7 })
      ],
      usd
    )
    expect(facts.freeShipping).toMatchObject({
      value: { amount: 100 },
      conflict: true
    })
    expect(facts.returnDays).toEqual({
      value: 14,
      conflict: true,
      fromPolicyPage: false
    })
    expect(facts.delivery).toMatchObject([{ min: 3, max: 7, conflict: true }])
    expect(facts.conflicts.map((c) => c.topic)).toEqual([
      'free_shipping',
      'returns',
      'delivery_days'
    ])
    expect(facts.conflicts[0]!.said).toEqual([
      {
        source: 'site',
        statement: 'Free shipping over $75.',
        url: 'https://shop.example/page',
        page: 'shipping'
      },
      {
        source: 'site',
        statement: 'Free shipping over $100.',
        url: 'https://shop.example/page',
        page: 'faq'
      }
    ])
  })

  it('ranks free shipping never, then the higher amount, then always, in any order', () => {
    const ship = (...values: Record<string, unknown>[]) =>
      trueFacts(
        values.map((v) => found('free_shipping', v)),
        usd
      ).freeShipping?.value ?? null
    expect(ship({ kind: 'always' }, over(50))).toEqual(over(50))
    expect(ship(over(50), { kind: 'never' }, { kind: 'always' })).toEqual({
      kind: 'never'
    })
    expect(ship({ kind: 'never' }, over(75), over(50, 'EUR'))).toEqual({
      kind: 'never'
    })
    expect(ship(over(75), over(50, 'EUR'), { kind: 'never' })).toEqual({
      kind: 'never'
    })
  })

  it('never takes an ad’s offer as the standing free shipping', () => {
    const facts = trueFacts(
      [found('free_shipping', { kind: 'always' }, { source: 'ads' })],
      usd
    )
    expect(facts.freeShipping).toBeNull()
    expect(facts.conflicts).toEqual([])
  })

  it('says nothing about free shipping it cannot check, and records why', () => {
    const euros = trueFacts([found('free_shipping', over(50, 'EUR'))], usd)
    expect(euros.freeShipping).toBeNull()
    expect(euros.conflicts).toMatchObject([
      { topic: 'free_shipping', reason: 'other_currency' }
    ])
    expect(
      trueFacts([found('free_shipping', over(50))], {
        live: true,
        currency: null
      }).freeShipping
    ).toBeNull()
  })

  it('counts only a money-back guarantee, never a warranty', () => {
    expect(
      trueFacts(
        [
          found(
            'guarantee',
            { days: 365 },
            {
              statement:
                'Every piece is covered by our 1-year guarantee against defects.'
            }
          )
        ],
        usd
      ).guaranteeDays
    ).toBeNull()
    expect(
      trueFacts([found('guarantee', { days: 30 }, moneyBack)], usd)
        .guaranteeDays?.value
    ).toBe(30)
  })

  it('keeps delivery windows per region, business days marked', () => {
    const facts = trueFacts(
      [
        found(
          'delivery_days',
          { min: 3, max: 5, region: 'United States' },
          {
            statement: 'Delivery takes 3–5 business days in the United States.'
          }
        ),
        found('delivery_days', { min: 7, max: 21, region: 'International' }),
        found('delivery_days', { min: 3, max: 5, region: 'united states' })
      ],
      usd
    )
    expect(facts.delivery).toEqual([
      {
        region: 'United States',
        min: 3,
        max: 5,
        businessDays: true,
        conflict: false
      },
      {
        region: 'International',
        min: 7,
        max: 21,
        businessDays: false,
        conflict: false
      }
    ])
    expect(facts.conflicts).toEqual([])
  })

  it('records no conflict when two pages say the same', () => {
    const facts = trueFacts(
      [
        found('returns', { days: 30 }, {}, 'returns'),
        found('returns', { days: 30 }, { statement: 'other page' }, 'faq')
      ],
      usd
    )
    expect(facts).toMatchObject({
      returnDays: { value: 30, conflict: false, fromPolicyPage: true },
      conflicts: []
    })
  })

  it('uses only sure findings that fit their topic, never sample rules for a live workspace', () => {
    const facts = trueFacts(
      [
        found('returns', { days: 30 }, { confidence: 0.59 }),
        found('guarantee', { days: 'sixty' }, moneyBack),
        found('delivery_days', { min: 2, max: 5 }, { pass: 'sample' })
      ],
      { live: false, currency: 'USD' }
    )
    expect(facts).toMatchObject({ returnDays: null, guaranteeDays: null })
    expect(facts.delivery).toHaveLength(1)
    expect(
      trueFacts([found('returns', { days: 30 }, { confidence: 0.6 })], usd)
        .returnDays?.value
    ).toBe(30)
    expect(
      trueFacts(
        [found('delivery_days', { min: 2, max: 5 }, { pass: 'sample' })],
        usd
      ).delivery
    ).toEqual([])
  })

  it('believes reviews are real only when the reviews reader found a verified platform', () => {
    const platform = (verified: boolean, source = 'reviews') =>
      found('review_platform', { name: 'Yotpo', verified }, { source })
    const verified = (...f: Finding[]) => trueFacts(f, usd).reviewsVerified
    expect(verified(platform(false))).toBe(false)
    expect(verified(platform(true, 'site'))).toBe(false)
    expect(verified(platform(false), platform(true))).toBe(true)
    expect(verified()).toBe(false)
  })
})

describe('copyFacts (ONB-106a)', () => {
  it('hands copy QA the facts, unknowns left null', () => {
    const facts = trueFacts(
      [
        found('free_shipping', over(75), {}, 'shipping'),
        found('returns', { days: 0 }, {}, 'returns')
      ],
      usd
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
      copyFacts(trueFacts([found('free_shipping', { kind: 'always' })], usd))
        .freeShipping
    ).toBe('always')
    expect(copyFacts(trueFacts([], usd)).freeShipping).toBeNull()
  })

  it('never states "no returns" from a product page or against another page', () => {
    const finalSale = copyFacts(
      trueFacts(
        [
          found('returns', { days: 30 }, {}, 'returns'),
          found('returns', { days: 0 }, {}, 'product')
        ],
        usd
      )
    )
    expect(finalSale.returnDays).toBeNull()
    const onlyProduct = copyFacts(
      trueFacts([found('returns', { days: 0 }, {}, 'product')], usd)
    )
    expect(onlyProduct.returnDays).toBeNull()
    // A shorter window is true under both: kept.
    const shorter = copyFacts(
      trueFacts(
        [
          found('returns', { days: 30 }, {}, 'returns'),
          found('returns', { days: 14 }, {}, 'faq')
        ],
        usd
      )
    )
    expect(shorter.returnDays).toBe(14)
  })

  it('never states "no free shipping" unless the shipping page alone says so', () => {
    const disagree = copyFacts(
      trueFacts(
        [
          found('free_shipping', over(75), {}, 'shipping'),
          found('free_shipping', { kind: 'never' }, {}, 'faq')
        ],
        usd
      )
    )
    expect(disagree.freeShipping).toBeNull()
    const policy = copyFacts(
      trueFacts(
        [found('free_shipping', { kind: 'never' }, {}, 'shipping')],
        usd
      )
    )
    expect(policy.freeShipping).toBe('never')
  })

  it('gives delivery only for everyone, in calendar days', () => {
    const regional = copyFacts(
      trueFacts(
        [found('delivery_days', { min: 3, max: 5, region: 'United States' })],
        usd
      )
    )
    expect(regional.deliveryDays).toBeNull()
    const business = copyFacts(
      trueFacts(
        [
          found(
            'delivery_days',
            { min: 3, max: 5 },
            { statement: 'Delivery takes 3 to 5 business days.' }
          )
        ],
        usd
      )
    )
    expect(business.deliveryDays).toEqual({ min: 3, max: 7 })
  })
})
