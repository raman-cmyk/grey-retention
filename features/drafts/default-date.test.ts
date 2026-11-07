import { describe, expect, it } from 'vitest'
import { draftDefaultDate } from './default-date'

// 14:20 on 6 Nov 2026 in New York.
const now = new Date('2026-11-06T19:20:00Z')
const tz = 'America/New_York'

describe('first-draft default send time', () => {
  it('uses 10:00 on a future day picked on the calendar', () => {
    expect(draftDefaultDate('2026-11-20', tz, now)).toBe('2026-11-20T10:00')
  })

  it('uses the next whole hour, at least an hour away, for today', () => {
    expect(draftDefaultDate('2026-11-06', tz, now)).toBe('2026-11-06T16:00')
  })

  it('moves to 10:00 tomorrow when today is nearly over', () => {
    const late = new Date('2026-11-07T03:30:00Z') // 22:30 in New York
    expect(draftDefaultDate('2026-11-06', tz, late)).toBe('2026-11-07T10:00')
  })

  it('picks the next calendar day before a daylight-saving change', () => {
    // 23:30 on 13 March 2027 in New York; clocks go forward that night.
    const night = new Date('2027-03-14T04:30:00Z')
    expect(draftDefaultDate('2027-03-13', tz, night)).toBe('2027-03-14T10:00')
  })

  it('reads "today" in the brand timezone, not UTC', () => {
    // 01:00 UTC on 7 Nov is still 6 Nov in New York, so 7 Nov is tomorrow.
    const evening = new Date('2026-11-07T01:00:00Z')
    expect(draftDefaultDate('2026-11-07', tz, evening)).toBe('2026-11-07T10:00')
  })

  it('ignores past days, impossible dates and junk', () => {
    const week = '2026-11-13T14:20'
    for (const bad of [
      '2026-11-05',
      '2026-02-30',
      '2026-13-01',
      '0999-01-01',
      '2026-11-6',
      '2026-11-20T10:00',
      ['2026-11-20'],
      undefined
    ])
      expect(draftDefaultDate(bad, tz, now), String(bad)).toBe(week)
  })

  it('survives a broken timezone', () => {
    expect(draftDefaultDate('2026-11-20', 'Not/AZone', now)).toBe(
      '2026-11-20T10:00'
    )
  })
})
