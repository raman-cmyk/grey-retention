import { describe, expect, it, vi } from 'vitest'
import {
  checkCopy,
  visibleText,
  withCopyQa,
  type BrandFacts,
  type CopyDraft,
  type QaRule
} from './check'

const facts: BrandFacts = {
  freeShipping: { over: 50 },
  deliveryDays: { min: 14, max: 28 },
  returnDays: 30,
  guaranteeDays: null,
  approvedClaims: ['100% vegan'],
  bannedPhrases: ['anti-aging'],
  reviewsVerified: false
}
const codes = [
  { code: 'WELCOME15', percent: 15, expiresAt: null },
  { code: 'FALL10', percent: 10, expiresAt: '2026-11-01T00:00:00Z' },
  { code: 'VIP40', percent: 40, expiresAt: null }
]
const productNames = ['PDRN Collagen Balm 5% Volufiline', 'SPF 50 Sunscreen']
const sendAt = '2026-11-10T21:45:00Z'
const draft = (body: string, extra: Partial<CopyDraft> = {}): CopyDraft => ({
  subject: 'Meet the new balm',
  preview: 'Our newest balm is here.',
  blocks: [{ id: 'hero', text: body }],
  ...extra
})
const check = (
  d: CopyDraft,
  overrides: Partial<Parameters<typeof checkCopy>[0]> = {}
) =>
  checkCopy({
    draft: d,
    facts,
    maxDiscountPercent: 20,
    codes,
    productNames,
    sendAt,
    ...overrides
  })
const rules = (r: ReturnType<typeof checkCopy>) => r.failures.map((f) => f.rule)

describe('checkCopy: a clean email passes', () => {
  it('passes prices, product names with numbers and approved claims', () => {
    const result = check(
      draft(
        '<p>The PDRN Collagen Balm 5% Volufiline is $34.99. 100% vegan. Free shipping over $50. Use code WELCOME15 for 15% off. Order early: delivery takes 2–4 weeks.</p>'
      )
    )
    expect(result).toEqual({ pass: true, failures: [] })
  })

  it('ignores numbers in CSS, attributes and Klaviyo tags', () => {
    const html =
      '<style>.a{width:100%}</style><table width="100%"><tr><td style="width:50%">Shop now</td></tr></table>{% unsubscribe "Unsubscribe" %}'
    expect(visibleText(html)).toBe('Shop now')
    expect(check(draft(html)).pass).toBe(true)
  })
})

describe('rule 6: max discount over every % and money amount', () => {
  it.each([
    ['30% off everything', 'discount_over_max'],
    ['Save 25% today', 'discount_over_max'],
    ['up to 50% off', 'discount_over_max'],
    ['Save $10 on your order', 'money_off'],
    ['$15 off sitewide', 'money_off']
  ])('blocks "%s"', (text, rule) => {
    const result = check(draft(text))
    expect(result.pass).toBe(false)
    expect(rules(result)).toContain(rule)
  })

  it('checks the subject and preview too', () => {
    const result = check(
      draft('Hello', { subject: '40% off ends tonight', preview: 'Save $5' })
    )
    expect(result.failures.map((f) => [f.field, f.rule])).toEqual([
      ['subject', 'discount_over_max'],
      ['preview', 'money_off']
    ])
  })

  it('refuses any discount when the brand allows none', () => {
    const result = check(draft('Get 10% off'), { maxDiscountPercent: 0 })
    expect(rules(result)).toEqual(['discount_not_allowed'])
    expect(result.failures[0].reason).toMatch(/no discount allowed/)
  })

  it('treats any other percentage as a claim the facts sheet must approve', () => {
    const result = check(draft('Visibly firmer skin for 97% of users'))
    expect(rules(result)).toEqual(['unsupported_percent'])
  })
})

describe('rule 7: codes only from the list', () => {
  it('blocks an invented code', () => {
    const result = check(draft('Use code SAVE20 at checkout for 20% off'))
    // 20% matches no usable code either.
    expect(rules(result)).toEqual(['discount_no_code', 'unknown_code'])
    expect(result.failures[1].reason).toContain('SAVE20')
  })

  it('blocks a code that expires before the send', () => {
    expect(rules(check(draft('Use code FALL10 for 10% off')))).toEqual([
      'discount_no_code',
      'expired_code'
    ])
  })

  it('blocks a listed code worth more than the max discount', () => {
    expect(rules(check(draft('Use code VIP40')))).toEqual(['code_over_max'])
  })

  it('reads "use code below" as words, not a code', () => {
    expect(check(draft('Use the code below at checkout')).pass).toBe(true)
  })

  it('matches listed codes case-insensitively', () => {
    expect(check(draft('Use code welcome15 for 15% off')).pass).toBe(true)
  })
})

describe('facts sheet', () => {
  it.each<[string, QaRule]>([
    ['Free shipping on everything!', 'shipping_claim'],
    ['Free shipping over $25', 'shipping_claim'],
    ['Arrives in time for Christmas', 'delivery_promise'],
    ['Get it by Friday', 'delivery_promise'],
    ['Next-day delivery', 'delivery_promise'],
    ['60-day returns', 'returns_claim'],
    ['60-day money-back guarantee', 'guarantee_claim'],
    ['Try it risk-free', 'guarantee_claim']
  ])('blocks "%s"', (text, rule) => {
    expect(rules(check(draft(text)))).toContain(rule)
  })

  it('allows a claim the sheet confirms', () => {
    const confirmed = {
      ...facts,
      guaranteeDays: 60,
      freeShipping: 'always' as const
    }
    expect(
      check(
        draft('Free shipping. 60-day money-back guarantee. 30-day returns.'),
        {
          facts: confirmed
        }
      ).pass
    ).toBe(true)
  })

  it('says why in plain words', () => {
    const [failure] = check(draft('Arrives in time for Christmas')).failures
    expect(failure.reason).toBe(
      'Delivery takes 14–28 days, so don\'t promise a date or speed. Say "order early" instead.'
    )
    expect(failure.excerpt).toContain('in time for Christmas')
  })

  it('refuses claims when the fact is unknown', () => {
    const unknown = { ...facts, returnDays: null, freeShipping: null }
    expect(
      rules(check(draft('Free shipping and free returns'), { facts: unknown }))
    ).toEqual(['shipping_claim', 'returns_claim'])
  })
})

describe('banned words and claims', () => {
  it("blocks the brand's banned list and default claims", () => {
    expect(rules(check(draft('Our anti-aging formula')))).toEqual([
      'banned_phrase'
    ])
    expect(rules(check(draft('Clinically proven to work')))).toEqual([
      'unsupported_claim'
    ])
    expect(rules(check(draft('The #1 balm')))).toEqual(['unsupported_claim'])
  })

  it('does not flag words that merely contain a banned word', () => {
    expect(check(draft('A secure checkout')).pass).toBe(true)
  })

  it('blocks ratings without a verified review source', () => {
    expect(rules(check(draft('Rated 4.9 by our customers')))).toEqual([
      'unverified_review'
    ])
    expect(rules(check(draft('★★★★★ loved it')))).toEqual(['unverified_review'])
    expect(
      check(draft('Rated 4.9 by our customers'), {
        facts: { ...facts, reviewsVerified: true }
      }).pass
    ).toBe(true)
  })
})

describe('withCopyQa', () => {
  it('regenerates with feedback until the copy passes', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(draft('40% off'))
      .mockResolvedValueOnce(draft('15% off with code WELCOME15'))
    const result = await withCopyQa({
      generate,
      check: (d) => check(d)
    })
    expect(result.status).toBe('passed')
    expect(result.attempts).toHaveLength(2)
    expect(generate.mock.calls[1][0][0].rule).toBe('discount_over_max')
  })

  it('sends the email to a human after three failed tries', async () => {
    const generate = vi.fn(async () => draft('Clinically proven'))
    const result = await withCopyQa({ generate, check: (d) => check(d) })
    expect(result.status).toBe('fallback')
    expect(generate).toHaveBeenCalledTimes(3)
  })
})

describe('gaps found by the assembly reviewer', () => {
  const unknown: BrandFacts = {
    ...facts,
    deliveryDays: null,
    returnDays: null,
    freeShipping: null
  }
  it.each<[string, QaRule]>([
    ['Orders ship in 1-2 business days', 'delivery_promise'],
    ['Arrives within a week', 'delivery_promise'],
    ['Orders ship within 24 hours', 'delivery_promise'],
    ['Return it within 30 days for a full refund', 'returns_claim'],
    ['See results in 7 days', 'unsupported_claim'],
    ['Loved by 10,000 customers', 'unverified_review'],
    ['Join 5k+ happy customers', 'unverified_review']
  ])('blocks "%s" when the facts are unknown', (text, rule) => {
    expect(rules(check(draft(text), { facts: unknown }))).toContain(rule)
  })

  it('blocks a delivery time faster than the confirmed one', () => {
    expect(rules(check(draft('Arrives within a week')))).toEqual([
      'delivery_promise'
    ])
    expect(check(draft('Delivery within 4 weeks')).pass).toBe(true)
  })

  it('allows a confirmed returns window', () => {
    expect(
      check(draft('Return it within 30 days for a full refund')).pass
    ).toBe(true)
  })

  it('requires the offer to match a usable code, not just the max', () => {
    const result = check(draft('Take 25% off with code WELCOME15'), {
      maxDiscountPercent: 30
    })
    expect(rules(result)).toEqual(['discount_no_code'])
    expect(result.failures[0].reason).toContain('WELCOME15 (15%)')
  })

  it('keeps going and keeps the feedback when a try throws', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(draft('40% off'))
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce(draft('15% off with code WELCOME15'))
    const result = await withCopyQa({ generate, check: (d) => check(d) })
    expect(result.status).toBe('passed')
    expect(result.errors).toHaveLength(1)
    expect(generate.mock.calls[2][0][0].rule).toBe('discount_over_max')
  })

  it('falls back with no draft when every try throws', async () => {
    const generate = vi.fn(async () => {
      throw new Error('down')
    })
    const result = await withCopyQa({ generate, check: (d) => check(d) })
    expect(result).toMatchObject({ status: 'fallback', draft: null })
    expect(result.errors).toHaveLength(3)
  })
})
