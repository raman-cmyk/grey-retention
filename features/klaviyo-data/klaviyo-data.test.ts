import { describe, expect, it, vi } from 'vitest'
import {
  lastDays,
  sampleKlaviyoSnapshot
} from '@/lib/providers/fake-klaviyo-read'
import {
  campaignsNewestFirst,
  currencyDigits,
  formatMoney,
  monthToDate,
  revenueSummary,
  upcomingKlaviyoCampaigns
} from './summary'

vi.mock('server-only', () => ({}))

const now = new Date('2026-11-06T12:00:00Z')
const tz = 'Australia/Sydney'
const snapshot = sampleKlaviyoSnapshot({ now, timezone: tz })

describe('sample Klaviyo data', () => {
  it('adds up: flows + campaigns equal the 30-day chart total', () => {
    const summary = revenueSummary(snapshot)
    expect(snapshot.daily).toHaveLength(30)
    expect(summary.flows.minor + summary.campaigns.minor).toBe(
      summary.total.minor
    )
    expect(summary.liveFlows).toBe(4)
    expect(summary.draftFlows).toBe(1)
    expect(summary.earningFlows).toBe(4)
    expect(summary.earningCampaigns).toBe(6)
  })

  it('is labelled sample and never claims a sync', () => {
    expect(snapshot.syncedAt).toBeNull()
    expect(snapshot.account.organization).toContain('sample')
  })

  it('uses one currency and names audiences instead of ids (§15 bug 6)', () => {
    const currencies = new Set([
      ...snapshot.daily.map((d) => d.revenue.currency),
      ...snapshot.flows.map((f) => f.revenue30d.currency)
    ])
    expect([...currencies]).toEqual([snapshot.account.currency])
    for (const c of snapshot.campaigns)
      for (const a of [...c.included, ...c.excluded])
        expect(a.name).not.toBe(a.id)
  })

  it('stays fictional, and past records are never in the future', () => {
    const text = JSON.stringify(snapshot)
    for (const host of text.match(/(?<=@|\/\/)[a-z0-9.-]+/gi) ?? [])
      expect(host).toMatch(/\.example$/)
    const early = sampleKlaviyoSnapshot({
      now: new Date('2026-11-06T03:00:00Z'),
      timezone: 'UTC'
    })
    for (const l of early.lists)
      expect(Date.parse(l.updated)).toBeLessThanOrEqual(
        Date.parse('2026-11-06T03:00:00Z')
      )
  })

  it('has 30 consecutive, unique days across daylight-saving changes', () => {
    for (const [at, zone] of [
      ['2026-11-02T07:30:00Z', 'America/Los_Angeles'],
      ['2026-10-04T13:30:00Z', 'Australia/Sydney'],
      ['2026-03-30T00:30:00Z', 'Europe/London']
    ] as const) {
      const days = lastDays(new Date(at), zone, 30)
      expect(new Set(days).size).toBe(30)
      for (let i = 1; i < days.length; i++)
        expect(Date.parse(days[i]) - Date.parse(days[i - 1])).toBe(86400000)
    }
    expect(
      lastDays(new Date('2026-11-02T07:30:00Z'), 'America/Los_Angeles', 1)
    ).toEqual(['2026-11-01'])
  })
})

describe('summaries', () => {
  it('counts only this month, in the brand timezone', () => {
    const mtd = monthToDate(snapshot, now, tz)
    const expected = snapshot.daily
      .filter((d) => d.date.startsWith('2026-11'))
      .reduce((total, d) => total + d.revenue.minor, 0)
    expect(mtd.minor).toBe(expected)
    // Oct 31 23:30 UTC is already Nov 1 in Sydney.
    const edge = sampleKlaviyoSnapshot({
      now: new Date('2026-10-31T23:30:00Z'),
      timezone: tz
    })
    expect(monthToDate(edge, new Date('2026-10-31T23:30:00Z'), tz).minor).toBe(
      edge.daily
        .filter((d) => d.date.startsWith('2026-11'))
        .reduce((t, d) => t + d.revenue.minor, 0)
    )
  })

  it('lists the next scheduled Klaviyo send and sorts newest first', () => {
    expect(upcomingKlaviyoCampaigns(snapshot, now).map((c) => c.name)).toEqual([
      'Holiday gift guide'
    ])
    const ordered = campaignsNewestFirst([
      ...snapshot.campaigns,
      { ...snapshot.campaigns[0], id: 'bad', sendTime: 'garbage' }
    ])
    const times = ordered.slice(0, -2).map((c) => Date.parse(c.sendTime!))
    expect(times).toEqual([...times].sort((a, b) => b - a))
    expect(ordered.slice(-2).map((c) => c.sendTime)).toContain('garbage')
  })

  it('formats money by each currency’s own decimals', () => {
    expect(formatMoney({ minor: 2263800, currency: 'USD' })).toBe('$22,638')
    expect(
      formatMoney({ minor: 2263800, currency: 'USD' }, { compact: true })
    ).toBe('$22.6K')
    expect(
      formatMoney({ minor: 1584599, currency: 'USD' }, { cents: true })
    ).toBe('$15,845.99')
    expect(formatMoney({ minor: 37200, currency: 'AUD' })).toBe('A$372')
    expect(formatMoney({ minor: 123456, currency: 'JPY' })).toBe('¥123,456')
    expect(currencyDigits('KWD')).toBe(3)
    expect(formatMoney({ minor: 100, currency: 'NOPE!' })).toBe('1 NOPE!')
  })
})
