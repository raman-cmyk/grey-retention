import { describe, expect, it } from 'vitest'
import type { OverviewCampaign } from '@/features/campaigns/overview-model'
import { sampleKlaviyoSnapshot } from '@/lib/providers/fake-klaviyo-read'
import {
  countdown,
  dashboardHref,
  dashboardKpis,
  gauge,
  numbersInsight,
  readQuery,
  upcomingSends
} from './model'

const now = new Date('2026-11-06T12:00:00Z')
const tz = 'Australia/Sydney'
const snapshot = sampleKlaviyoSnapshot({ now, timezone: tz })

const local = (over: Partial<OverviewCampaign>) =>
  ({
    id: 'c1',
    title: 'Local draft',
    planned_at: '2026-11-08T00:00:00Z',
    superseded_by_plan: null,
    calendar_state: 'approved',
    delivery_state: 'not_ready',
    ...over
  }) as OverviewCampaign

describe('dashboard links keep the rest of the page (§3 fix)', () => {
  it('changes only what a link is for', () => {
    const current = readQuery({
      tab: 'campaigns',
      attr: 'utm',
      p: '2',
      junk: 'x'
    })
    expect(current).toEqual({ tab: 'campaigns', attr: 'utm', p: '2' })
    expect(dashboardHref(current, { attr: null })).toBe(
      '/dashboard?tab=campaigns&p=2'
    )
    expect(dashboardHref(current, { tab: 'flows' }, 'klaviyo-data')).toBe(
      '/dashboard?tab=flows&attr=utm&p=2#klaviyo-data'
    )
    expect(dashboardHref({}, {})).toBe('/dashboard')
    expect(readQuery({ tab: ['lists', 'flows'] })).toEqual({ tab: 'lists' })
  })
})

describe('dashboard model', () => {
  it('shows only real KPIs, each naming its source and period', () => {
    const kpis = dashboardKpis(snapshot)
    expect(kpis.map((k) => k.label)).toEqual([
      'Active subscribers',
      'Net change',
      'Revenue · flows',
      'Revenue · campaigns',
      'Abandoned checkouts'
    ])
    expect(kpis[0]).toMatchObject({
      value: '16.5K',
      trend: 'up',
      caption: '↑ 15% vs previous 30d'
    })
    expect(kpis[1]).toMatchObject({
      value: '+2.2K',
      caption: 'subscribers · 30d'
    })
    expect(kpis[2].caption).toBe('from 4 flows · 30d')
    expect(kpis[3].caption).toBe('from 6 campaigns · 30d')
  })

  it('handles a flat or wiped-out subscriber count', () => {
    const flat = dashboardKpis({
      ...snapshot,
      activeSubscribers: { count: 100, changePercent: 0 }
    })
    expect(flat[0].trend).toBeUndefined()
    expect(flat[0].caption).toBe('0% vs previous 30d')
    const gone = dashboardKpis({
      ...snapshot,
      activeSubscribers: { count: 0, changePercent: -100 }
    })
    expect(gone[1].value).toBe('—')
    expect(gone[0].caption).not.toMatch(/∞|NaN/)
  })

  it('lists sends that can still go out, from the workspace AND Klaviyo', () => {
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
        local({ id: 'e', title: 'Old plan', superseded_by_plan: 'p1' }),
        local({ id: 'f', title: 'Rejected', calendar_state: 'rejected' }),
        local({ id: 'g', title: 'Failed', delivery_state: 'failed' }),
        local({ id: 'h', title: 'Blocked', delivery_state: 'blocked' })
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
    expect(sends[1]).toMatchObject({
      source: 'klaviyo',
      href: null,
      status: 'scheduled'
    })
    expect(sends[0].status).toBe('draft')
  })

  it('words the countdown plainly, with a date beyond a month', () => {
    expect(countdown('2026-11-08T16:00:00Z', now)).toBe('in 2 days 4 hours')
    expect(countdown('2026-11-06T13:35:00Z', now)).toBe('in 1 hour 35 minutes')
    expect(countdown('2026-11-06T12:00:20Z', now)).toBe('in 1 minute')
    expect(countdown('2099-04-05T04:45:00Z', now, 'Asia/Kathmandu')).toBe(
      'on Apr 5, 2099'
    )
    expect(countdown('2026-11-01T00:00:00Z', now)).toBe('now')
    expect(countdown('garbage', now)).toBe('now')
  })

  it('shows month-to-date revenue and no goal until one is set', () => {
    const noGoal = gauge(snapshot, now, null, tz)
    expect(noGoal.goal).toBeNull()
    expect(noGoal.fraction).toBe(0)
    expect(
      gauge(snapshot, now, noGoal.value.minor * 2, tz).fraction
    ).toBeCloseTo(0.5)
  })

  it('writes an insight whose shares add up to 100%', () => {
    const text = numbersInsight(snapshot)
    const [flows, campaigns] = [...text.matchAll(/(\d+)%/g)].map((m) =>
      Number(m[1])
    )
    expect(flows + campaigns).toBe(100)
    expect(text).toContain('Abandoned checkout was the top flow')
  })
})
