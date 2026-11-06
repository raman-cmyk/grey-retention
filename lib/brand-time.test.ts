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
