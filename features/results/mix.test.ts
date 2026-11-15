import { describe, expect, it } from 'vitest'
import { defaultMix, emailMix, offerShareCap } from './mix'
import type { ResultLine } from './read-model'

let n = 0
/** A sent, final, real email of `type` that reached `people` and earned `revenue`. */
const sent = (
  emailType: string,
  revenue: number | null,
  over: Partial<ResultLine> = {},
  people = 1000,
  clicks = 20
): ResultLine => ({
  buildId: `b${++n}`,
  subject: null,
  plannedDay: null,
  emailType,
  status: 'sent',
  statusText: 'Sent',
  sentAt: '2026-11-01T10:00:00Z',
  final: true,
  complete: true,
  sample: false,
  totals: {
    recipients: people,
    opens: 400,
    clicks,
    orders: revenue === null ? null : 2,
    revenue,
    openRate: 0.4,
    clickRate: clicks / people
  },
  ab: null,
  topSection: null,
  ...over
})
const many = (count: number, make: () => ResultLine) =>
  Array.from({ length: count }, make)

describe('emailMix (PLN-037)', () => {
  it('uses the default mix without history', () => {
    expect(emailMix([], { emails: 6 })).toEqual({
      counts: { offer: 2, story: 1, education: 1, product: 2 },
      shares: { ...defaultMix },
      basis: 'default',
      learnedFrom: 0,
      measure: null
    })
    expect(emailMix([], { emails: 10 }).counts).toEqual({
      offer: 3,
      story: 2,
      education: 2,
      product: 3
    })
  })

  it('ignores sample, unsent, not-final and unknown emails', () => {
    const ignored = [
      sent('story', 900, { sample: true }),
      sent('story', 900, { final: false }),
      sent('story', 900, { status: 'deleted' }),
      sent('story', 900, { totals: null }),
      sent('story', 900, {}, 0),
      sent('newsletter', 900),
      sent('story', 900, { emailType: null })
    ]
    expect(emailMix(ignored, { emails: 6 })).toMatchObject({
      basis: 'default',
      learnedFrom: 0
    })
  })

  it('moves toward the kind that earns more per person, slowly', () => {
    // Story emails earn three times the others.
    const lines = [
      ...many(10, () => sent('story', 300)),
      ...many(10, () => sent('offer', 100)),
      ...many(10, () => sent('launch', 100)),
      ...many(10, () => sent('education', 100))
    ]
    const mix = emailMix(lines, { emails: 10 })
    expect(mix.basis).toBe('learned')
    expect(mix.learnedFrom).toBe(40)
    expect(mix.measure).toBe('revenue_per_person')
    expect(mix.shares.story).toBeGreaterThan(defaultMix.story)
    expect(mix.shares.offer).toBeLessThan(defaultMix.offer)
    // Its weight moves at most half again its default, then all are scaled to 1.
    expect(mix.shares.story).toBeLessThan(0.34)
    expect(mix.counts).toEqual({ offer: 3, story: 3, education: 2, product: 2 })
    // One story email is not enough to move far.
    const one = emailMix(
      [sent('story', 300), ...many(10, () => sent('offer', 100))],
      { emails: 10 }
    )
    expect(one.shares.story - defaultMix.story).toBeLessThan(
      mix.shares.story - defaultMix.story
    )
  })

  it('never plans offers above the plan’s offer share', () => {
    const lines = [
      ...many(30, () => sent('offer', 1000)),
      ...many(30, () => sent('story', 10))
    ]
    const mix = emailMix(lines, { emails: 6 })
    expect(mix.shares.offer).toBeLessThanOrEqual(offerShareCap + 1e-9)
    expect(mix.counts.offer).toBeLessThanOrEqual(Math.floor(6 * offerShareCap))
    for (const emails of [1, 2, 3, 4, 5, 7, 9, 12])
      expect(emailMix(lines, { emails }).counts.offer).toBeLessThanOrEqual(
        Math.floor(emails * offerShareCap)
      )
  })

  it('always adds up to the emails asked for', () => {
    for (const emails of [0, 1, 2, 3, 5, 6, 7, 11, 15])
      expect(
        Object.values(emailMix([], { emails }).counts).reduce(
          (a, b) => a + b,
          0
        )
      ).toBe(emails)
    expect(emailMix([], { emails: -3 }).counts).toEqual({
      offer: 0,
      story: 0,
      education: 0,
      product: 0
    })
  })

  it('uses clicks per person when some orders could not be read', () => {
    const lines = [
      ...many(10, () => sent('education', null, {}, 1000, 60)),
      ...many(10, () => sent('offer', 500, {}, 1000, 20))
    ]
    const mix = emailMix(lines, { emails: 6 })
    expect(mix.measure).toBe('clicks_per_person')
    expect(mix.shares.education).toBeGreaterThan(defaultMix.education)
  })

  it('does not let one big email or a tiny send swing the mix', () => {
    const steady = [
      ...many(10, () => sent('offer', 100)),
      ...many(10, () => sent('education', 100)),
      ...many(10, () => sent('launch', 100))
    ]
    const before = emailMix(steady, { emails: 9 })
    // One story email with a single $5,000 order.
    const big = emailMix([...steady, sent('story', 5000)], { emails: 9 })
    expect(big.shares.story).toBeLessThan(0.25)
    expect(big.counts.story).toBeLessThanOrEqual(2)
    expect(big.counts).toEqual(before.counts)
    // A story email sent to 3 people is not counted at all.
    const tiny = emailMix([...steady, sent('story', 150, {}, 3)], { emails: 9 })
    expect(tiny.learnedFrom).toBe(before.learnedFrom)
  })

  it('keeps revenue as the measure when a few emails’ orders were not read', () => {
    const lines = [
      ...many(15, () => sent('offer', 500, {}, 1000, 10)),
      ...many(15, () => sent('education', 50, {}, 1000, 40)),
      ...many(15, () => sent('story', 50, {}, 1000, 40))
    ]
    const before = emailMix(lines, { emails: 9 })
    const after = emailMix([...lines, sent('launch', null)], { emails: 9 })
    expect(after.measure).toBe('revenue_per_person')
    expect(after.counts).toEqual(before.counts)
  })

  it('takes the offer limit the plan allows, and shares the freed emails fairly', () => {
    expect(emailMix([], { emails: 9, maxOffers: 1 }).counts).toEqual({
      offer: 1,
      story: 2,
      education: 2,
      product: 4
    })
    expect(emailMix([], { emails: 6, maxOffers: 0 }).counts.offer).toBe(0)
    // Two emails: the offer is cut by the 40% share; story and product share the rest.
    expect(emailMix([], { emails: 2 }).counts).toEqual({
      offer: 0,
      story: 1,
      education: 0,
      product: 1
    })
  })

  it('ignores unknown types, and a history that moves nothing stays the default', () => {
    expect(
      emailMix([sent('toString', 1000), sent('constructor', 1000)], {
        emails: 6
      })
    ).toMatchObject({ basis: 'default', learnedFrom: 0 })
    // Only offer emails, all alike: nothing to compare, nothing moves.
    expect(
      emailMix(
        many(20, () => sent('offer', 100)),
        { emails: 6 }
      )
    ).toMatchObject({ basis: 'default', learnedFrom: 0, counts: { offer: 2 } })
    expect(emailMix([], { emails: 6.5 }).counts).toEqual({
      offer: 0,
      story: 0,
      education: 0,
      product: 0
    })
  })

  it('stays on the default when nothing earned anything', () => {
    expect(
      emailMix(
        many(5, () => sent('story', 0, {}, 1000, 0)),
        { emails: 6 }
      )
    ).toMatchObject({ basis: 'default', learnedFrom: 0 })
  })
})
