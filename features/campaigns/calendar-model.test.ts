import { describe, expect, it } from 'vitest'
import {
  adjacentCalendarMonth,
  calendarMonth,
  localCalendarDate
} from './calendar-model'

describe('campaign calendar presentation', () => {
  const now = new Date('2024-02-29T18:30:00Z')

  it('validates query months, falling back to the tenant local month', () => {
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
  })

  it('moves between months across year boundaries without JavaScript short-year conversion', () => {
    expect(adjacentCalendarMonth('2026-12', 1)).toBe('2027-01')
    expect(adjacentCalendarMonth('2026-01', -1)).toBe('2025-12')
    expect(adjacentCalendarMonth('0099-12', 1)).toBe('0100-01')
    expect(adjacentCalendarMonth('0001-01', -1)).toBeNull()
    expect(adjacentCalendarMonth('9999-12', 1)).toBeNull()
  })

  it('places UTC instants in tenant dates at month boundaries and daylight saving changes', () => {
    expect(
      localCalendarDate(new Date('2024-01-31T20:00:00Z'), 'Asia/Kathmandu')
    ).toBe('2024-02-01')
    expect(
      localCalendarDate(new Date('2024-10-05T16:30:00Z'), 'Australia/Melbourne')
    ).toBe('2024-10-06')
  })
})
