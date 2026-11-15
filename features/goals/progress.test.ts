import { describe, expect, it } from 'vitest'
import type { ResultLine } from '@/features/results/read-model'
import { goalProgress } from './progress'

let n = 0
const email = (
  sentAt: string,
  revenue: number | null,
  over: Partial<ResultLine> = {}
): ResultLine =>
  // Cast: PLN-037 adds `emailType` to ResultLine; this builds either way.
  ({
    buildId: `b${++n}`,
    subject: null,
    plannedDay: null,
    emailType: null,
    status: 'sent',
    statusText: 'Sent',
    sentAt,
    final: true,
    complete: true,
    sample: false,
    totals: {
      recipients: 1000,
      opens: 400,
      clicks: 20,
      orders: revenue === null ? null : 3,
      revenue,
      openRate: 0.4,
      clickRate: 0.02
    },
    ab: null,
    topSection: null,
    ...over
  }) as ResultLine
const goal = { month: '2026-11-01', amount: 20000, currency: 'USD' }
const base = {
  goal,
  today: '2026-11-15',
  timezone: 'America/New_York',
  storeCurrency: 'USD',
  sendsPerWeek: 3
}

describe('goalProgress (PLN-033b)', () => {
  it('works backwards to emails, and says when they fit', () => {
    // $7,600 so far in November; the three recent emails average $3,000.
    const lines = [
      email('2026-10-20T15:00:00Z', 1400),
      email('2026-11-03T15:00:00Z', 1600),
      email('2026-11-10T15:00:00Z', 6000)
    ]
    const p = goalProgress({ ...base, lines })!
    expect(p).toMatchObject({
      soFar: 7600,
      soFarFinal: true,
      remaining: 12400,
      daysLeft: 16,
      perEmail: 3000,
      perEmailFrom: 3,
      awaiting: 0,
      emailsNeeded: 5,
      emailsPossible: 6,
      needsStrongerEmails: false,
      pace: 'on_track'
    })
    expect(p.sentence).toBe(
      '$12,400 still needed by 30 November. Recent emails earned about $3,000 each, so about 5 more emails; 6 fit at 3 a week.'
    )
  })

  it('is behind when more emails are needed than fit: the plan needs stronger emails', () => {
    const lines = [
      email('2026-11-03T15:00:00Z', 1000),
      email('2026-11-10T15:00:00Z', 1000)
    ]
    const p = goalProgress({ ...base, lines })!
    expect(p).toMatchObject({
      remaining: 18000,
      perEmail: 1000,
      emailsNeeded: 18,
      emailsPossible: 6,
      needsStrongerEmails: true,
      pace: 'behind'
    })
    expect(p.sentence).toContain(
      'only 6 fit at 3 a week, so the plan needs stronger emails, such as offers.'
    )
  })

  it('is behind, not unknown, when recent emails earned nothing', () => {
    const p = goalProgress({
      ...base,
      lines: [
        email('2026-11-03T15:00:00Z', 0),
        email('2026-11-10T15:00:00Z', 0)
      ]
    })!
    expect(p).toMatchObject({
      perEmail: 0,
      perEmailFrom: 2,
      emailsNeeded: null,
      needsStrongerEmails: true,
      pace: 'behind'
    })
    expect(p.sentence).toContain(
      'Recent emails earned nothing, so more emails alone will not reach it'
    )
  })

  it('counts emails sent but not read yet, and says the numbers are still to come', () => {
    const p = goalProgress({
      ...base,
      lines: [
        email('2026-11-04T15:00:00Z', 1000),
        email('2026-11-14T20:00:00Z', null, { totals: null, final: false }),
        email('2026-11-15T14:00:00Z', null, {
          status: 'sending',
          totals: null,
          final: false
        })
      ]
    })!
    expect(p).toMatchObject({
      soFar: 1000,
      soFarFinal: false,
      awaiting: 2,
      perEmail: 1000,
      // 19,000 still needed, 2,000 of it likely from the two being read.
      emailsNeeded: 17
    })
    expect(p.sentence).toContain(
      '(some of this month’s numbers are still to come)'
    )
    expect(p.sentence).toContain('after the 2 still being read')
  })

  it('keeps a sent email Klaviyo later lost in what was earned, not in what an email earns', () => {
    const p = goalProgress({
      ...base,
      lines: [
        email('2026-11-04T15:00:00Z', 5000, { status: 'deleted' }),
        email('2026-11-05T15:00:00Z', 1000)
      ]
    })!
    expect(p).toMatchObject({
      soFar: 6000,
      soFarFinal: false,
      perEmail: 1000,
      perEmailFrom: 1
    })
    expect(p.sentence).toContain('The one recent email earned $1,000')
  })

  it('leaves out sample emails and leaves incomplete reads out of what an email earns', () => {
    const p = goalProgress({
      ...base,
      lines: [
        email('2026-11-03T15:00:00Z', 9000, { sample: true }),
        email('2026-11-05T15:00:00Z', 800, { complete: false }),
        email('2026-11-06T15:00:00Z', null)
      ]
    })!
    expect(p).toMatchObject({
      soFar: 800,
      soFarFinal: false,
      perEmail: null,
      emailsNeeded: null,
      pace: 'unknown'
    })
    expect(p.sentence).toBe(
      '$19,200 still needed by 30 November (some of this month’s numbers are still to come); there are no final email results yet to estimate how many emails that takes.'
    )
  })

  it('is met once the month’s revenue reaches the goal', () => {
    const p = goalProgress({
      ...base,
      lines: [email('2026-11-03T15:00:00Z', 21300)]
    })!
    expect(p).toMatchObject({ remaining: 0, emailsNeeded: 0, pace: 'met' })
    expect(p.sentence).toBe(
      'The $20,000 goal for November 2026 is met: $21,300 from GROS emails.'
    )
  })

  it('counts an email by its day in the store’s timezone', () => {
    // 03:00 UTC on 1 November is still 31 October in New York.
    const p = goalProgress({
      ...base,
      lines: [
        email('2026-11-01T03:00:00Z', 500),
        email('2026-12-01T03:00:00Z', 700),
        email('not a time', 900)
      ]
    })!
    expect(p.soFar).toBe(700)
  })

  it('uses the last 90 days, today included, for what an email earns', () => {
    const p = goalProgress({
      ...base,
      lines: [
        email('2026-08-17T15:00:00Z', 90000),
        email('2026-08-18T15:00:00Z', 3000),
        email('2026-11-03T15:00:00Z', 1000)
      ]
    })!
    expect(p).toMatchObject({ perEmail: 2000, perEmailFrom: 2 })
  })

  it('divides in whole cents, so an exact fit stays a fit', () => {
    // 700.70 / 100.10 is 7 exactly (in floating point it is 7.000000000000001).
    const exact = goalProgress({
      ...base,
      goal: { ...goal, amount: 700.7 },
      today: '2026-11-14',
      lines: [email('2026-10-03T15:00:00Z', 100.1)]
    })!
    expect(exact).toMatchObject({
      emailsNeeded: 7,
      emailsPossible: 7,
      pace: 'on_track'
    })
  })

  it('cannot compare a goal in another currency, or before the currency is known', () => {
    const other = goalProgress({
      ...base,
      storeCurrency: 'AUD',
      lines: [email('2026-11-03T15:00:00Z', 2000)]
    })!
    expect(other).toMatchObject({
      pace: 'unknown',
      soFar: null,
      remaining: null,
      emailsNeeded: null,
      perEmail: null
    })
    expect(other.sentence).toBe(
      'The goal is in USD but the store reports AUD, so progress cannot be measured.'
    )
    expect(
      goalProgress({ ...base, storeCurrency: null, lines: [] })!.sentence
    ).toBe(
      'The store’s currency is not known yet, so progress cannot be measured.'
    )
  })

  it('handles a month that is over or still to come, and its last days', () => {
    const over = goalProgress({
      ...base,
      today: '2026-12-02',
      lines: [email('2026-11-03T15:00:00Z', 5000)]
    })!
    expect(over).toMatchObject({
      daysLeft: 0,
      emailsPossible: 0,
      emailsNeeded: null,
      needsStrongerEmails: false,
      pace: 'missed'
    })
    expect(over.sentence).toBe(
      'November 2026 is over: $5,000 from GROS emails of the $20,000 goal.'
    )
    const next = goalProgress({
      ...base,
      goal: { ...goal, month: '2026-12-01' },
      lines: [email('2026-11-03T15:00:00Z', 5000)]
    })!
    expect(next).toMatchObject({
      soFar: 0,
      daysLeft: 31,
      emailsPossible: 13,
      emailsNeeded: 4,
      pace: 'on_track'
    })
    // The last day still fits one email, and says so.
    const last = goalProgress({
      ...base,
      today: '2026-11-30',
      goal: { ...goal, amount: 1000 },
      lines: [email('2026-11-03T15:00:00Z', 600)]
    })!
    expect(last).toMatchObject({
      daysLeft: 1,
      emailsPossible: 1,
      emailsNeeded: 1
    })
    expect(last.sentence).toContain(
      'so about 1 more email; 1 fits at 3 a week.'
    )
    // A leap February.
    expect(
      goalProgress({
        ...base,
        goal: { ...goal, month: '2028-02-01' },
        today: '2028-02-01',
        lines: []
      })!.daysLeft
    ).toBe(29)
  })

  it('marks “so far” not final when the lines may not cover the month', () => {
    expect(
      goalProgress({
        ...base,
        coversFrom: '2026-11-08',
        lines: [email('2026-11-10T15:00:00Z', 1000)]
      })!.soFarFinal
    ).toBe(false)
  })

  it('refuses inputs it cannot use', () => {
    for (const bad of [
      { today: '15 Nov' },
      { today: '2026-13-01' },
      { today: '2026-11-31' },
      { goal: { ...goal, month: '2026-11-15' } },
      { goal: { ...goal, month: '2026-13-01' } },
      { goal: { ...goal, amount: 0 } },
      { goal: { ...goal, amount: Infinity } },
      { goal: { ...goal, currency: 'usd' } },
      { sendsPerWeek: 0 },
      { sendsPerWeek: 15 },
      { sendsPerWeek: 2.5 },
      { timezone: 'Not/AZone' },
      { coversFrom: 'soon' }
    ])
      expect(
        goalProgress({ ...base, lines: [], ...bad }),
        JSON.stringify(bad)
      ).toBeNull()
    expect(
      goalProgress({ ...base, sendsPerWeek: 14, lines: [] })
    ).not.toBeNull()
  })
})
