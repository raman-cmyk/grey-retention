import { describe, expect, it } from 'vitest'
import { formatBrandDateTime, relativeTime, timezoneLabel } from './brand-time'

describe('brand time', () => {
  it('formats in the brand timezone, as in the old app', () => {
    const at = '2026-10-07T11:49:00Z'
    expect(formatBrandDateTime(at, 'Australia/Sydney')).toBe(
      'Oct 7, 2026 · 10:49 PM'
    )
    expect(formatBrandDateTime(at, 'America/Los_Angeles')).toBe(
      'Oct 7, 2026 · 4:49 AM'
    )
  })

  it('never throws on bad input', () => {
    expect(formatBrandDateTime('not a date', 'UTC')).toBeNull()
    expect(formatBrandDateTime(null, 'UTC')).toBeNull()
    expect(formatBrandDateTime('2026-10-07T11:49:00Z', 'Mars/Base')).toBe(
      'Oct 7, 2026 · 11:49 AM'
    )
  })

  it('names the timezone in plain words', () => {
    expect(timezoneLabel('Australia/Sydney')).toBe('Sydney time')
    expect(timezoneLabel('America/Los_Angeles')).toBe('Los Angeles time')
    expect(timezoneLabel('UTC')).toBe('UTC')
    expect(timezoneLabel('Mars/Base')).toBe('UTC')
    expect(timezoneLabel('Etc/GMT+5')).toBe('UTC-5')
  })

  it('says how long ago in words', () => {
    const now = new Date('2026-11-06T12:00:00Z')
    expect(relativeTime('2026-10-07T11:49:00Z', now)).toBe('4 weeks ago')
    expect(relativeTime('2026-11-06T11:59:30Z', now)).toBe('just now')
    expect(relativeTime('2026-11-09T12:00:00Z', now)).toBe('in 3 days')
    expect(relativeTime('2024-11-01T00:00:00Z', now)).toBe('2 years ago')
    expect(relativeTime('garbage', now)).toBeNull()
    expect(relativeTime('2025-11-09T12:00:00Z', now)).toBe('11 months ago')
    expect(relativeTime('2026-09-25T12:00:00Z', now)).toBe('1 month ago')
  })
})

describe('one brand timezone, named next to every time (UIR-023)', () => {
  it('names the zone after the date and time', async () => {
    const { formatBrandDateTimeWithZone, formatBrandTimeWithZone } =
      await import('./brand-time')
    const at = '2026-11-06T17:04:00Z'
    expect(formatBrandDateTimeWithZone(at, 'Asia/Kathmandu')).toBe(
      'Nov 6, 2026 · 10:49 PM (Kathmandu time)'
    )
    expect(formatBrandTimeWithZone(at, 'Asia/Kathmandu')).toBe(
      '10:49 PM Kathmandu time'
    )
    expect(formatBrandDateTimeWithZone(null, 'Asia/Kathmandu')).toBeNull()
    expect(formatBrandTimeWithZone('not a date', 'UTC')).toBeNull()
  })

  it('follows daylight saving (spring forward and fall back)', async () => {
    const { formatBrandDateTimeWithZone, timezoneWithOffset } =
      await import('./brand-time')
    // New York jumps from 2:00 to 3:00 AM on 14 March 2027.
    expect(
      formatBrandDateTimeWithZone('2027-03-14T06:30:00Z', 'America/New_York')
    ).toBe('Mar 14, 2027 · 1:30 AM (New York time)')
    expect(
      formatBrandDateTimeWithZone('2027-03-14T07:30:00Z', 'America/New_York')
    ).toBe('Mar 14, 2027 · 3:30 AM (New York time)')
    expect(
      timezoneWithOffset('America/New_York', new Date('2027-01-15T12:00:00Z'))
    ).toBe('America/New_York (UTC-05:00)')
    expect(
      timezoneWithOffset('America/New_York', new Date('2027-07-15T12:00:00Z'))
    ).toBe('America/New_York (UTC-04:00)')
    // Melbourne repeats 2:00–3:00 AM on 4 April 2027.
    expect(
      formatBrandDateTimeWithZone('2027-04-03T15:30:00Z', 'Australia/Melbourne')
    ).toBe('Apr 4, 2027 · 2:30 AM (Melbourne time)')
    expect(
      formatBrandDateTimeWithZone('2027-04-03T16:30:00Z', 'Australia/Melbourne')
    ).toBe('Apr 4, 2027 · 2:30 AM (Melbourne time)')
    expect(
      timezoneWithOffset(
        'Australia/Melbourne',
        new Date('2027-04-03T15:30:00Z')
      )
    ).toBe('Australia/Melbourne (UTC+11:00)')
    expect(
      timezoneWithOffset(
        'Australia/Melbourne',
        new Date('2027-04-03T16:30:00Z')
      )
    ).toBe('Australia/Melbourne (UTC+10:00)')
  })

  it('falls back to UTC for a missing or unknown timezone', async () => {
    const {
      formatBrandDateTimeWithZone,
      isKnownTimezone,
      timezoneOptions,
      timezoneWithOffset
    } = await import('./brand-time')
    expect(isKnownTimezone('Asia/Kathmandu')).toBe(true)
    expect(isKnownTimezone('Mars/Olympus')).toBe(false)
    expect(isKnownTimezone('')).toBe(false)
    expect(
      formatBrandDateTimeWithZone('2026-11-06T17:04:00Z', 'Mars/Olympus')
    ).toBe('Nov 6, 2026 · 5:04 PM (UTC)')
    expect(timezoneWithOffset('', new Date('2026-11-06T12:00:00Z'))).toBe(
      'UTC (UTC+00:00)'
    )
    const options = timezoneOptions('Asia/Kathmandu')
    expect(options[0]).toBe('UTC')
    // The workspace's own zone is always offered, whatever the runtime calls it.
    expect(options).toContain('Asia/Kathmandu')
    expect(options).toContain('Europe/London')
    expect(options.filter((zone) => zone === 'UTC')).toHaveLength(1)
    expect(timezoneOptions('Mars/Olympus')).not.toContain('Mars/Olympus')
  })
})
