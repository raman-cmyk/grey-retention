import { describe, expect, it } from 'vitest'
import type { OverviewCampaign } from '@/features/campaigns/overview-model'
import { sampleKlaviyoSnapshot } from '@/features/klaviyo-data/fixture'
import { revenueSummary } from '@/features/klaviyo-data/summary'
import {
  countdown,
  dashboardKpis,
  gauge,
  numbersInsight,
  upcomingSends
} from './model'

const now = new Date('2026-11-06T12:00:00Z')
const snapshot = sampleKlaviyoSnapshot({ now, timezone: 'Australia/Sydney' })

const local = (over: Partial<OverviewCampaign>) =>
  ({
    id: 'c1',
    title: 'Local draft',
    planned_at: '2026-11-08T00:00:00Z',
    superseded_by_plan: null,
    delivery_state: 'not_ready',
    ...over
  }) as OverviewCampaign

describe('dashboard model', () => {
  it('shows only real KPIs, each naming its source and period', () => {
    const kpis = dashboardKpis(snapshot)
    expect(kpis.map((k) => k.label)).toEqual([
      'Active subscribers',
      'List growth',
      'Revenue · flows',
      'Revenue · campaigns',
      'Abandoned checkouts'
    ])
    expect(kpis.some((k) => /coming soon/i.test(k.caption))).toBe(false)
    expect(kpis[0]).toMatchObject({ value: '16.5K', trend: 'up' })
    expect(kpis[0].caption).toBe('↑ 15% vs previous 30d')
    expect(kpis[1].value).toBe('+2.2K')
  })

  it('matches revenue tiles to the same totals as the chart', () => {
    const summary = revenueSummary(snapshot)
    const kpis = dashboardKpis(snapshot)
    expect(kpis[2].caption).toBe(`${summary.liveFlows} live flows · 30d`)
    expect(kpis[3].caption).toBe(`${summary.sentCampaigns} campaigns · 30d`)
  })

  it('lists upcoming sends from the workspace AND Klaviyo, soonest first', () => {
    const sends = upcomingSends(
      [
        local({
          id: 'a',
          title: 'Later local',
          planned_at: '2026-11-20T00:00:00Z'
        }),
        local({
          id: 'b',
          title: 'Soon local',
          planned_at: '2026-11-07T00:00:00Z'
        }),
        local({ id: 'c', title: 'Past', planned_at: '2026-11-01T00:00:00Z' }),
        local({ id: 'd', title: 'Sent', delivery_state: 'sent' }),
        local({ id: 'e', title: 'Old plan', superseded_by_plan: 'p1' })
      ],
      snapshot,
      now
    )
    expect(sends.map((s) => s.name)).toEqual([
      'Soon local',
      'Holiday gift guide',
      'Later local'
    ])
    expect(sends[0].href).toBe('/campaigns/b')
    expect(sends[1]).toMatchObject({ source: 'klaviyo', href: null })
    expect(upcomingSends([], null, now)).toEqual([])
  })

  it('words the countdown plainly', () => {
    expect(countdown('2026-11-08T16:00:00Z', now)).toBe('in 2 days 4 hours')
    expect(countdown('2026-11-06T13:35:00Z', now)).toBe('in 1 hour 35 minutes')
    expect(countdown('2026-11-06T12:00:20Z', now)).toBe('in 1 minute')
    expect(countdown('2026-11-01T00:00:00Z', now)).toBe('now')
    expect(countdown('garbage', now)).toBe('now')
  })

  it('shows month-to-date revenue and no goal until one is set', () => {
    const noGoal = gauge(snapshot, now, null)
    expect(noGoal.goal).toBeNull()
    expect(noGoal.fraction).toBe(0)
    const half = gauge(snapshot, now, noGoal.value.minor * 2)
    expect(half.fraction).toBeCloseTo(0.5)
    expect(gauge(snapshot, now, 1).fraction).toBe(1)
  })

  it('writes an insight from the numbers alone', () => {
    const text = numbersInsight(snapshot)
    expect(text).toMatch(/^Flows earned \d+% of your email revenue/)
    expect(text).toContain('Abandoned checkout was the top flow')
    expect(text).toContain('“Spring restock”')
  })
})
