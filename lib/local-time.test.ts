import { describe, expect, it } from 'vitest'
import {
  localDateTime,
  localTimeCandidates,
  occurrenceField,
  resolveLocalTime,
  resolveLocalTimeFields
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

describe('resolveLocalTimeFields (date-and-time pickers)', () => {
  it('converts picked workspace times to exact UTC and keeps other fields', () => {
    const result = resolveLocalTimeFields(
      {
        kind: 'offer',
        starts_at: '2026-11-06T09:00',
        ends_at: '2026-12-06T21:30'
      },
      ['starts_at', 'ends_at'],
      'Asia/Kathmandu'
    )
    expect(result).toEqual({
      ok: true,
      values: {
        kind: 'offer',
        starts_at: '2026-11-06T03:15:00.000Z',
        ends_at: '2026-12-06T15:45:00.000Z'
      }
    })
  })

  it('saves the same local time it shows back', () => {
    const result = resolveLocalTimeFields(
      { planned_at: '2026-07-01T18:05' },
      ['planned_at'],
      'Australia/Melbourne'
    )
    if (!result.ok) throw new Error(result.error)
    expect(
      localDateTime(result.values.planned_at as string, 'Australia/Melbourne')
    ).toBe('2026-07-01T18:05')
  })

  it('leaves missing or empty fields for the schema to reject', () => {
    expect(
      resolveLocalTimeFields(
        { kind: 'run', start: '' },
        ['start', 'other'],
        'UTC'
      )
    ).toEqual({ ok: true, values: { kind: 'run', start: '' } })
  })

  it.each([
    ['an old ISO value', '2026-11-01T10:00:00Z'],
    ['an offset value', '2026-11-01T10:00+05:45'],
    ['free text', 'tomorrow at ten'],
    ['a date only', '2026-11-01']
  ])('refuses %s instead of guessing', (_label, value) => {
    expect(
      resolveLocalTimeFields({ start: value }, ['start'], 'Asia/Kathmandu')
    ).toEqual({ ok: false, error: 'Choose a date and time.' })
  })

  it('refuses a non-text value', () => {
    expect(
      resolveLocalTimeFields({ start: 42 }, ['start'], 'UTC')
    ).toMatchObject({ ok: false })
  })

  it('refuses a time skipped when clocks go forward', () => {
    const result = resolveLocalTimeFields(
      { scheduledAt: '2026-03-08T02:30' },
      ['scheduledAt'],
      'America/New_York'
    )
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.error).toContain('does not exist')
  })

  it('asks which one when a time happens twice, and uses the choice', () => {
    const value = { observedAt: '2026-11-01T01:30' }
    const missing = resolveLocalTimeFields(
      value,
      ['observedAt'],
      'America/New_York'
    )
    expect(!missing.ok && missing.error).toContain('occurs twice')
    expect(
      resolveLocalTimeFields(
        { ...value, [occurrenceField('observedAt')]: 'later' },
        ['observedAt'],
        'America/New_York'
      )
    ).toEqual({ ok: true, values: { observedAt: '2026-11-01T06:30:00.000Z' } })
    expect(
      resolveLocalTimeFields(
        { ...value, observedAtOccurrence: 'earlier' },
        ['observedAt'],
        'America/New_York'
      )
    ).toEqual({ ok: true, values: { observedAt: '2026-11-01T05:30:00.000Z' } })
  })

  it('uses the server timezone, not anything the browser sends', () => {
    const result = resolveLocalTimeFields(
      { start: '2026-11-06T09:00', timezone: 'UTC' },
      ['start'],
      'Asia/Kathmandu'
    )
    expect(result).toMatchObject({
      ok: true,
      values: { start: '2026-11-06T03:15:00.000Z' }
    })
  })
})
