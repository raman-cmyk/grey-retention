// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { reasonsFor } from '@/features/email-build/reasons'
import { builtEmail, plannedEmail } from '@/features/email-build/build'
import { slotsInWindow } from './dates'
import { withoutUnusableOffers, type PlanOffers } from './offers'
import { ladderKept, type PlannedSlot } from './plan'

/**
 * PICK-104 review: the ladder places the plan gave its offer emails stay
 * only while the worker's guards (REL-DAT's 15 days, REL-OFF's offers that
 * would not work) keep every offer email as planned. Otherwise "the second
 * of 3" would be untrue, so no offer reason is given at all.
 */
const zone = 'Australia/Melbourne'
const offers: PlanOffers = {
  maxDiscountPercent: 25,
  codes: [
    { code: 'SMALL10', percent: 10, expiresAt: null },
    // Ends at 2 pm on the 19th: the 3 pm email on the 19th cannot use it.
    { code: 'MID15', percent: 15, expiresAt: '2026-11-19T14:00:00+11:00' },
    { code: 'BIG25', percent: 25, expiresAt: null }
  ]
}
const offerEmail = (
  date: string,
  time: string,
  code: string,
  percent: number,
  step: number,
  before: number | null
): PlannedSlot => ({
  date,
  time,
  emailType: 'offer',
  angle: 'The sale is on',
  products: [{ id: 'p-candle', title: 'Cedar candle' }],
  offer: { id: `offer:${code}`, code, percent },
  audience: { id: 'engaged', label: 'Engaged subscribers' },
  ladder: { step, steps: 3, before, lowest: step === 1 },
  why: 'Run the store’s sale over these days.',
  evidence: [{ id: `offer:${code}`, fact: `${percent}% off with ${code}.` }]
})
const story: PlannedSlot = {
  date: '2026-11-18',
  time: '10:00',
  emailType: 'story',
  angle: 'From the workshop',
  products: [],
  offer: null,
  audience: { id: 'engaged', label: 'Engaged subscribers' },
  why: 'A note from the store.',
  evidence: []
}
const sale = [
  offerEmail('2026-11-17', '10:00', 'SMALL10', 10, 1, null),
  story,
  offerEmail('2026-11-19', '15:00', 'MID15', 15, 2, 10),
  offerEmail('2026-11-24', '10:00', 'BIG25', 25, 3, 15)
]

describe('the ladder places after the plan’s guards (ladderKept)', () => {
  it('removes every place when the offer guard takes the middle offer email out', () => {
    const guarded = withoutUnusableOffers(sale, offers, zone)
    // The guard turned the middle one into a story but kept its fields.
    expect(guarded.dropped).toEqual([sale[2]])
    expect(guarded.slots[2]!.emailType).toBe('story')
    expect(guarded.slots[2]!.ladder).toBeDefined()
    const kept = ladderKept(sale, guarded.slots)
    expect(kept.map((s) => s.ladder)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined
    ])
    expect(kept.map((s) => s.emailType)).toEqual([
      'offer',
      'story',
      'story',
      'offer'
    ])
    // So the last offer email's page gives no offer reason ("the third of 3").
    const last = plannedEmail.parse(kept[3])
    expect(
      reasonsFor({
        planned: last,
        email: builtEmail.parse({
          sample: false,
          ai: false,
          name: 'Tue 24 Nov · Offer',
          subject: 'The sale goes on',
          preheader: '25% off',
          html: '<p>B</p>',
          approach: 'A',
          copy: 'plain',
          plannedSendAt: '2026-11-23T23:00:00Z',
          audienceId: 'engaged',
          productIds: ['p-candle'],
          code: 'BIG25',
          offer: { percent: 25, expiresAt: null },
          changes: []
        }),
        progress: {}
      }).filter((r) => r.kind === 'offer')
    ).toEqual([])
  })

  it('removes every place when the 15-day guard drops an offer email', () => {
    const dated = slotsInWindow(sale, '2026-11-17')
    // The 24th is in the window; one more on the 2nd of December is not.
    const late = offerEmail('2026-12-02', '10:00', 'BIG25', 25, 3, 15)
    const withLate = [...sale.slice(0, 3), late]
    const droppedLate = slotsInWindow(withLate, '2026-11-17')
    expect(droppedLate.dropped).toEqual([late])
    expect(
      ladderKept(withLate, droppedLate.slots).every((s) => !s.ladder)
    ).toBe(true)
    // Nothing dropped: the places are kept as they are.
    expect(dated.dropped).toEqual([])
    expect(ladderKept(sale, dated.slots)).toEqual(sale)
  })

  it('keeps the places when the guards keep every offer email', () => {
    const fine = sale.filter((_, i) => i !== 2)
    const guarded = withoutUnusableOffers(fine, offers, zone)
    expect(guarded.dropped).toEqual([])
    expect(ladderKept(fine, guarded.slots)).toEqual(fine)
  })
})
