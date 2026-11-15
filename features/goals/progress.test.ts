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
    // $7,600 so far in November; recent emails earn about $1,520 each.
    const lines = [
      email('2026-10-20T15:00:00Z', 1400),
      email('2026-11-03T15:00:00Z', 1600),
      email('2026-11-10T15:00:00Z', 6000, { buildId: 'big' })
    ]
    const p = goalProgress({ ...base, lines })!
    expect(p).toMatchObject({
      soFar: 7600,
      soFarFinal: true,
      remaining: 12400,
      daysLeft: 16,
      perEmail: 3000,
      perEmailFrom: 3,
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

  it('is met once the month’s revenue reaches the goal', () => {
    const p = goalProgress({
      ...base,
      lines: [email('2026-11-03T15:00:00Z', 21300)]
    })!
    expect(p).toMatchObject({ remaining: 0, emailsNeeded: 0, pace: 'met' })
    expect(p.sentence).toBe(
      'The $20,000 goal for November 2026 is met: $21,300 so far.'
    )
  })

  it('counts an email by its day in the store’s timezone', () => {
    // 03:00 UTC on 1 November is still 31 October in New York.
    const p = goalProgress({
      ...base,
      lines: [
        email('2026-11-01T03:00:00Z', 500),
        email('2026-12-01T03:00:00Z', 700)
      ]
    })!
    expect(p.soFar).toBe(700)
  })

  it('leaves out sample and unsent emails, and says when numbers are not final', () => {
    const p = goalProgress({
      ...base,
      lines: [
        email('2026-11-03T15:00:00Z', 9000, { sample: true }),
        email('2026-11-04T15:00:00Z', 9000, { status: 'deleted' }),
        email('2026-11-05T15:00:00Z', 800, { final: false }),
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
      '$19,200 still needed by 30 November (some of this month’s numbers are not final yet); there are no final email results yet to estimate how many emails that takes.'
    )
  })

  it('uses only the last 90 days for what an email earns', () => {
    const p = goalProgress({
      ...base,
      lines: [
        email('2026-07-01T15:00:00Z', 90000),
        email('2026-11-03T15:00:00Z', 2000)
      ]
    })!
    expect(p).toMatchObject({ perEmail: 2000, perEmailFrom: 1 })
  })

  it('cannot compare a goal in another currency', () => {
    const p = goalProgress({
      ...base,
      storeCurrency: 'AUD',
      lines: [email('2026-11-03T15:00:00Z', 2000)]
    })!
    expect(p).toMatchObject({
      pace: 'unknown',
      emailsNeeded: null,
      perEmail: null
    })
    expect(p.sentence).toBe(
      'The goal is in USD but the store reports AUD, so progress cannot be measured.'
    )
  })

  it('handles a month that is over or still to come', () => {
    const over = goalProgress({
      ...base,
      today: '2026-12-02',
      lines: [email('2026-11-03T15:00:00Z', 5000)]
    })!
    expect(over).toMatchObject({
      daysLeft: 0,
      pace: 'behind',
      emailsPossible: 0
    })
    expect(over.sentence).toBe(
      'November 2026 is over: $5,000 of the $20,000 goal.'
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
    // The last day of the month counts.
    expect(
      goalProgress({ ...base, today: '2026-11-30', lines: [] })!.daysLeft
    ).toBe(1)
  })

  it('refuses inputs it cannot use', () => {
    for (const bad of [
      { today: '15 Nov' },
      { goal: { ...goal, month: '2026-11-15' } },
      { goal: { ...goal, amount: 0 } },
      { goal: { ...goal, currency: 'usd' } },
      { sendsPerWeek: 0 },
      { sendsPerWeek: 2.5 },
      { timezone: 'Not/AZone' }
    ])
      expect(
        goalProgress({ ...base, lines: [], ...bad }),
        JSON.stringify(bad)
      ).toBeNull()
  })
})
