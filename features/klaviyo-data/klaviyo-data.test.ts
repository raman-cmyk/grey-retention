import { afterEach, describe, expect, it, vi } from 'vitest'
import { sampleKlaviyoSnapshot } from './fixture'
import {
  campaignsNewestFirst,
  formatMoney,
  monthToDate,
  revenueSummary,
  upcomingKlaviyoCampaigns
} from './summary'

vi.mock('server-only', () => ({}))

const now = new Date('2026-11-06T12:00:00Z')
const snapshot = sampleKlaviyoSnapshot({ now, timezone: 'Australia/Sydney' })

describe('sample Klaviyo data', () => {
  it('adds up: flows + campaigns equal the 30-day chart total', () => {
    const summary = revenueSummary(snapshot)
    expect(snapshot.daily).toHaveLength(30)
    expect(summary.flows.minor + summary.campaigns.minor).toBe(
      summary.total.minor
    )
    expect(summary.liveFlows).toBe(4)
    expect(summary.draftFlows).toBe(1)
    expect(summary.bestDay?.revenue.minor).toBe(
      Math.max(...snapshot.daily.map((d) => d.revenue.minor))
    )
  })

  it('uses one currency and the brand timezone everywhere', () => {
    const currencies = new Set([
      ...snapshot.daily.map((d) => d.revenue.currency),
      ...snapshot.flows.map((f) => f.revenue30d.currency),
      ...snapshot.campaigns.flatMap((c) =>
        c.revenue30d ? [c.revenue30d.currency] : []
      )
    ])
    expect([...currencies]).toEqual([snapshot.account.currency])
    expect(snapshot.account.timezone).toBe('Australia/Sydney')
    expect(snapshot.account.organization).toContain('sample')
  })

  it('names audiences instead of showing raw ids (§15 bug 6)', () => {
    for (const c of snapshot.campaigns)
      for (const a of [...c.included, ...c.excluded]) {
        expect(a.name).not.toBe(a.id)
        expect(a.name.length).toBeGreaterThan(2)
      }
  })

  it('stays fictional and current', () => {
    const text = JSON.stringify(snapshot)
    expect(text).toContain('shop.example')
    expect(text).not.toMatch(/@(?!example)[a-z0-9-]+\.[a-z]{2,}/i)
    expect(Date.parse(snapshot.syncedAt)).toBeLessThan(now.getTime())
  })
})

describe('summaries', () => {
  it('counts only this month (brand timezone) for month to date', () => {
    const mtd = monthToDate(snapshot, now)
    const expected = snapshot.daily
      .filter((d) => d.date.startsWith('2026-11'))
      .reduce((total, d) => total + d.revenue.minor, 0)
    expect(mtd.minor).toBe(expected)
    expect(mtd.minor).toBeLessThan(revenueSummary(snapshot).total.minor)
  })

  it('lists the next scheduled Klaviyo send and sorts newest first', () => {
    expect(upcomingKlaviyoCampaigns(snapshot, now).map((c) => c.name)).toEqual([
      'Holiday gift guide'
    ])
    const ordered = campaignsNewestFirst(snapshot.campaigns)
    const times = ordered
      .filter((c) => c.sendTime)
      .map((c) => Date.parse(c.sendTime!))
    expect(times).toEqual([...times].sort((a, b) => b - a))
    expect(ordered.at(-1)?.sendTime).toBeNull()
  })

  it('formats money one way, and survives an unknown currency', () => {
    expect(formatMoney({ minor: 2263800, currency: 'USD' })).toBe('$22,638')
    expect(
      formatMoney({ minor: 2263800, currency: 'USD' }, { compact: true })
    ).toBe('$22.6K')
    expect(
      formatMoney({ minor: 1584599, currency: 'USD' }, { cents: true })
    ).toBe('$15,845.99')
    expect(formatMoney({ minor: 37200, currency: 'AUD' })).toBe('A$372')
    expect(formatMoney({ minor: 100, currency: 'NOPE!' })).toBe('1 NOPE!')
  })
})

describe('reader', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('labels fake data as sample and never invents live data', async () => {
    const { klaviyoData } = await import('./reader')
    vi.stubEnv('ADAPTER_MODE', 'fake')
    const sample = await klaviyoData('UTC', now)
    expect(sample.state).toBe('sample')
    vi.stubEnv('ADAPTER_MODE', 'real')
    expect(await klaviyoData('Europe/Paris', now)).toEqual({
      state: 'not_connected'
    })
  })
})
