// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  countryFromTimezone,
  easter,
  platformHolidays,
  type HolidayCountry
} from './platform'

const dates = (country: HolidayCountry, from: string, days = 90) =>
  platformHolidays({ country, from, days }).map((h) => `${h.date} ${h.name}`)

describe('platformHolidays', () => {
  it('matches the old app’s US list for early November 2026', () => {
    expect(dates('US', '2026-11-06', 56)).toEqual([
      '2026-11-11 Veterans Day',
      '2026-11-26 Thanksgiving',
      '2026-11-27 Black Friday',
      '2026-11-30 Cyber Monday',
      '2026-12-01 Giving Tuesday',
      '2026-12-04 Hanukkah begins',
      '2026-12-14 Free Shipping Day',
      '2026-12-24 Christmas Eve',
      '2026-12-25 Christmas Day',
      '2026-12-26 Boxing Day',
      '2026-12-31 New Year’s Eve'
    ])
  })

  it('shows the next 90 days only, across the new year', () => {
    const list = platformHolidays({ country: 'US', from: '2026-11-06' })
    expect(list.at(-1)!.date < '2027-02-04').toBe(true)
    expect(list.map((h) => h.name)).toContain('Martin Luther King Jr. Day')
    expect(
      list.find((h) => h.name === 'Martin Luther King Jr. Day')?.date
    ).toBe('2027-01-18')
    expect(
      platformHolidays({ country: 'US', from: '2026-11-06', days: 1 })
    ).toEqual([])
  })

  it('is not US-centric for other countries', () => {
    const au = dates('AU', '2026-11-06')
    expect(au).toContain('2026-12-26 Boxing Day')
    expect(au).toContain('2027-01-26 Australia Day')
    expect(au.join()).not.toMatch(/Thanksgiving|Veterans/)
    expect(dates('GB', '2026-11-06')).toContain('2026-11-08 Remembrance Sunday')
    expect(dates('IN', '2026-11-06')).toContain('2026-11-08 Diwali')
    expect(dates('CA', '2026-10-01', 20)).toContain('2026-10-12 Thanksgiving')
    expect(dates('NZ', '2026-10-01', 30)).toContain('2026-10-26 Labour Day')
    expect(dates('INTL', '2026-11-06').join()).not.toMatch(
      /Thanksgiving|Veterans/
    )
  })

  it('computes moving dates correctly', () => {
    expect(easter(2026)).toEqual({ y: 2026, m: 4, d: 5 })
    expect(easter(2027)).toEqual({ y: 2027, m: 3, d: 28 })
    expect(dates('GB', '2027-03-01', 10)).toContain('2027-03-07 Mother’s Day')
    expect(dates('CA', '2027-05-01', 30)).toContain('2027-05-24 Victoria Day')
    expect(dates('CA', '2026-05-01', 30)).toContain('2026-05-18 Victoria Day')
    expect(dates('US', '2027-05-01', 31)).toContain('2027-05-31 Memorial Day')
    expect(dates('NZ', '2027-06-01', 30)).toContain('2027-06-25 Matariki')
  })

  it('labels each day with a category for its colour', () => {
    const list = platformHolidays({
      country: 'US',
      from: '2026-11-06',
      days: 30
    })
    expect(list.find((h) => h.name === 'Veterans Day')?.category).toBe('civic')
    expect(list.find((h) => h.name === 'Black Friday')?.category).toBe(
      'commercial'
    )
    expect(list.find((h) => h.name === 'Hanukkah begins')?.category).toBe(
      'cultural'
    )
    const december = platformHolidays({
      country: 'GB',
      from: '2026-12-20',
      days: 10
    })
    expect(december.find((h) => h.name === 'Christmas Day')?.category).toBe(
      'civic'
    )
  })
})

describe('countryFromTimezone', () => {
  it('guesses the country from the brand timezone', () => {
    expect(countryFromTimezone('US/Pacific')).toBe('US')
    expect(countryFromTimezone('America/New_York')).toBe('US')
    expect(countryFromTimezone('America/Toronto')).toBe('CA')
    expect(countryFromTimezone('America/Montreal')).toBe('CA')
    expect(countryFromTimezone('America/Dawson_Creek')).toBe('CA')
    expect(countryFromTimezone('America/Puerto_Rico')).toBe('US')
    expect(countryFromTimezone('EST5EDT')).toBe('US')
    expect(countryFromTimezone('GB-Eire')).toBe('GB')
    expect(countryFromTimezone('NZ-CHAT')).toBe('NZ')
    expect(countryFromTimezone('Europe/London')).toBe('GB')
    expect(countryFromTimezone('Australia/Melbourne')).toBe('AU')
    expect(countryFromTimezone('Pacific/Auckland')).toBe('NZ')
    expect(countryFromTimezone('Asia/Kolkata')).toBe('IN')
    expect(countryFromTimezone('Asia/Kathmandu')).toBe('INTL')
    expect(countryFromTimezone('America/Sao_Paulo')).toBe('INTL')
  })
})
