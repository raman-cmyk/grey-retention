import { describe, expect, it } from 'vitest'
import {
  adjacentCalendarMonth,
  buildCampaignCalendar,
  calendarMonth,
  calendarView,
  localCalendarDate,
  type CalendarCampaign
} from './calendar-model'

function campaign(
  id: string,
  planned_at: string,
  overrides: Partial<CalendarCampaign> = {}
): CalendarCampaign {
  return {
    id,
    title: `Campaign ${id}`,
    planned_at,
    channel: 'email_text',
    calendar_revision: 1,
    calendar_state: 'proposed',
    copy_state: 'draft',
    delivery_state: 'not_ready',
    synthetic: true,
    superseded_by_plan: null,
    ...overrides
  }
}

describe('campaign calendar presentation', () => {
  const now = new Date('2024-02-29T18:30:00Z')

  it('validates query months and views, falling back to the tenant local month', () => {
    expect(calendarMonth('2024-02', 'Asia/Kathmandu', now)).toBe('2024-02')
    for (const input of [
      undefined,
      '2024-00',
      '2024-13',
      '2024-2',
      '0000-01',
      'next month',
      ['2024-02', '2024-03']
    ]) {
      expect(calendarMonth(input, 'Asia/Kathmandu', now)).toBe('2024-03')
    }
    expect(calendarMonth(undefined, 'America/New_York', now)).toBe('2024-02')
    expect(calendarView('list')).toBe('list')
    expect(calendarView('history')).toBe('history')
    expect(calendarView(['history', 'list'])).toBe('calendar')
    expect(calendarView('unknown')).toBe('calendar')
  })

  it('moves between months across year boundaries without JavaScript short-year conversion', () => {
    expect(adjacentCalendarMonth('2026-12', 1)).toBe('2027-01')
    expect(adjacentCalendarMonth('2026-01', -1)).toBe('2025-12')
    expect(adjacentCalendarMonth('0099-12', 1)).toBe('0100-01')
    expect(adjacentCalendarMonth('0001-01', -1)).toBeNull()
    expect(adjacentCalendarMonth('9999-12', 1)).toBeNull()
  })

  it('renders complete Monday-first weeks with real leap days, empty days and local today', () => {
    const leap = buildCampaignCalendar({
      campaigns: [],
      month: '2024-02',
      timezone: 'Asia/Kathmandu',
      view: 'calendar',
      now: new Date('2024-02-28T19:00:00Z')
    })
    expect(leap.days).toHaveLength(35)
    expect(leap.days[0]).toMatchObject({ date: '2024-01-29', inMonth: false })
    expect(leap.days.at(-1)).toMatchObject({
      date: '2024-03-03',
      inMonth: false
    })
    expect(leap.days.filter((day) => day.inMonth)).toHaveLength(29)
    expect(leap.days.filter((day) => day.today)).toMatchObject([
      { date: '2024-02-29', campaigns: [] }
    ])
    const ordinary = buildCampaignCalendar({
      campaigns: [],
      month: '2021-02',
      timezone: 'UTC',
      view: 'calendar',
      now
    })
    expect(ordinary.days).toHaveLength(28)
    expect(ordinary.days.every((day) => day.inMonth && !day.today)).toBe(true)
    const long = buildCampaignCalendar({
      campaigns: [],
      month: '2026-03',
      timezone: 'UTC',
      view: 'calendar',
      now
    })
    expect(long.days).toHaveLength(42)
    expect(long.days.filter((day) => day.inMonth)).toHaveLength(31)
  })

  it('places UTC instants in tenant dates at month boundaries and daylight saving changes', () => {
    expect(
      localCalendarDate(new Date('2024-01-31T20:00:00Z'), 'Asia/Kathmandu')
    ).toBe('2024-02-01')
    expect(
      localCalendarDate(new Date('2024-10-05T16:30:00Z'), 'Australia/Melbourne')
    ).toBe('2024-10-06')
    const source = [
      campaign('late', '2024-02-01T12:00:00Z'),
      campaign('before', '2024-01-31T18:00:00Z'),
      campaign('early', '2024-01-31T20:00:00Z'),
      campaign('after', '2024-02-29T19:00:00Z')
    ]
    const result = buildCampaignCalendar({
      campaigns: source,
      month: '2024-02',
      timezone: 'Asia/Kathmandu',
      view: 'calendar',
      now
    })
    expect(result.entries.map((entry) => entry.id)).toEqual(['early', 'late'])
    expect(
      result.days
        .find((day) => day.date === '2024-02-01')!
        .campaigns.map((entry) => entry.id)
    ).toEqual(['early', 'late'])
    expect(source.map((entry) => entry.id)).toEqual([
      'late',
      'before',
      'early',
      'after'
    ])
  })

  it('keeps superseded entries in History only and counts exact calendar and delivery states', () => {
    const source = [
      campaign('pending', '2024-02-01T12:00:00Z'),
      campaign('approved', '2024-02-02T12:00:00Z', {
        calendar_state: 'approved',
        delivery_state: 'scheduled'
      }),
      campaign('rejected', '2024-02-03T12:00:00Z', {
        calendar_state: 'rejected'
      }),
      campaign('old', '2024-02-04T12:00:00Z', {
        superseded_by_plan: 'later-plan'
      })
    ]
    for (const view of ['calendar', 'list'] as const) {
      const result = buildCampaignCalendar({
        campaigns: source,
        month: '2024-02',
        timezone: 'UTC',
        view,
        now
      })
      expect(result.entries.map((entry) => entry.id)).toEqual([
        'pending',
        'approved',
        'rejected'
      ])
      expect(result).toMatchObject({
        reviewCount: 1,
        approvedCount: 1,
        scheduledCount: 1
      })
    }
    const history = buildCampaignCalendar({
      campaigns: source,
      month: '2024-02',
      timezone: 'UTC',
      view: 'history',
      now
    })
    expect(history.entries.map((entry) => entry.id)).toEqual([
      'pending',
      'approved',
      'rejected',
      'old'
    ])
    expect(history.reviewCount).toBe(1)
  })
})
