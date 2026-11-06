import { describe, expect, it } from 'vitest'
import {
  localDateTime,
  localTimeCandidates,
  resolveLocalTime
} from './local-time'

describe('Workspace local time', () => {
  it('round-trips fractional offsets and calendar boundaries', () => {
    expect(localDateTime('2026-10-28T23:45:00Z', 'Asia/Kathmandu')).toBe(
      '2026-10-29T05:30'
    )
    expect(resolveLocalTime('2026-10-28T10:00', 'Asia/Kathmandu')).toBe(
      '2026-10-28T04:15:00.000Z'
    )
    expect(resolveLocalTime('2026-01-01T00:00', 'UTC')).toBe(
      '2026-01-01T00:00:00.000Z'
    )
  })
  it.each([
    '2026-02-30T12:00',
    '2026-13-01T12:00',
    '2026-11-01T24:00',
    'tomorrow',
    '2026-10-28T10:00Z'
  ])('rejects invalid wall time %s', (value) => {
    expect(localTimeCandidates(value, 'UTC')).toEqual([])
  })
  it('rejects skipped spring time instead of moving the requested hour', () => {
    expect(() =>
      resolveLocalTime('2026-03-08T02:30', 'America/New_York')
    ).toThrow('does not exist')
    expect(localTimeCandidates('2011-12-30T12:00', 'Pacific/Apia')).toEqual([])
  })
  it('requires an explicit choice for repeated fall time', () => {
    expect(() =>
      resolveLocalTime('2026-11-01T01:30', 'America/New_York')
    ).toThrow('occurs twice')
    expect(
      resolveLocalTime('2026-11-01T01:30', 'America/New_York', 'earlier')
    ).toBe('2026-11-01T05:30:00.000Z')
    expect(
      resolveLocalTime('2026-11-01T01:30', 'America/New_York', 'later')
    ).toBe('2026-11-01T06:30:00.000Z')
  })
  it('handles half-hour daylight saving transitions', () => {
    expect(
      localTimeCandidates('2026-04-05T01:45', 'Australia/Lord_Howe')
    ).toEqual(['2026-04-04T14:45:00.000Z', '2026-04-04T15:15:00.000Z'])
    expect(
      localTimeCandidates('2026-10-04T02:15', 'Australia/Lord_Howe')
    ).toEqual([])
  })
})
