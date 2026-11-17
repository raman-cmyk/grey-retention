import { describe, expect, it } from 'vitest'
import { timezoneWithOffset as zoneWithOffset } from '@/lib/brand-time'
import { localTime } from './defaults'

describe('timezone display', () => {
  const at = new Date('2026-11-06T17:07:00Z')

  it('shows the zone with its current UTC offset', () => {
    expect(zoneWithOffset('US/Pacific', at)).toBe('US/Pacific (UTC-08:00)')
    expect(zoneWithOffset('Asia/Kathmandu', at)).toBe(
      'Asia/Kathmandu (UTC+05:45)'
    )
    expect(zoneWithOffset('UTC', at)).toBe('UTC (UTC+00:00)')
    expect(zoneWithOffset('US/Pacific', new Date('2026-07-01T12:00:00Z'))).toBe(
      'US/Pacific (UTC-07:00)'
    )
  })

  it('shows UTC instead of failing for a zone this runtime does not know', () => {
    expect(zoneWithOffset('posix/Asia/Kathmandu', at)).toMatch(/UTC/)
    expect(zoneWithOffset('Factory', at)).toMatch(/UTC/)
    expect(localTime('Factory', at)).toBe('Fri, Nov 6 2026 · 5:07 PM')
  })

  it('shows the local time like the old app', () => {
    expect(localTime('US/Pacific', at)).toBe('Fri, Nov 6 2026 · 9:07 AM')
    expect(localTime('Australia/Melbourne', at)).toBe(
      'Sat, Nov 7 2026 · 4:07 AM'
    )
  })
})
