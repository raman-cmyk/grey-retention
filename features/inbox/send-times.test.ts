import { describe, expect, it } from 'vitest'
import { sendTimeMap } from './send-times'

const row = (sentAt: string) => ({
  facts: {
    version: 2,
    subject: 'New in',
    preview: null,
    offer: { kind: 'none', value: null, code: null },
    angle: 'launch',
    cta: 'Shop',
    sentAt,
    blockSequence: ['header_logo', 'hero_image'],
    textRatio: 0.3,
    sections: 4
  }
})
// Sunday 15 November 2026, noon in Sydney.
const now = Date.parse('2026-11-15T01:00:00Z')
const sydney = { now, timezone: 'Australia/Sydney' }

describe('sendTimeMap (CMP-048)', () => {
  it('maps day and hour in the reader’s timezone', () => {
    // 22:30 UTC on Monday is 09:30 on Tuesday in Sydney (UTC+11).
    const map = sendTimeMap(
      [row('2026-11-09T22:30:00Z'), row('2026-11-02T22:10:00Z')],
      sydney
    )!
    expect(map.grid[1]![9]).toBe(2)
    expect(map.byDay.find((d) => d.day === 'Tue')!.emails).toBe(2)
    expect(map.usual).toEqual([{ day: 'Tue', hour: 9, emails: 2 }])
    expect(
      sendTimeMap([row('2026-11-09T22:30:00Z')], {
        now,
        timezone: 'UTC'
      })!.byDay.find((d) => d.day === 'Mon')!.emails
    ).toBe(1)
  })

  it('counts every week from the first one, with gaps as 0', () => {
    const map = sendTimeMap(
      [
        row('2026-10-20T00:00:00Z'),
        row('2026-10-21T00:00:00Z'),
        row('2026-11-10T00:00:00Z')
      ],
      sydney
    )!
    expect(map.byWeek).toEqual([
      { weekStart: '2026-10-19', emails: 2 },
      { weekStart: '2026-10-26', emails: 0 },
      { weekStart: '2026-11-02', emails: 0 },
      { weekStart: '2026-11-09', emails: 1 }
    ])
    expect(map.perWeek).toBe(0.8)
  })

  it('keeps to the window and skips rows it cannot read', () => {
    const map = sendTimeMap(
      [
        row('2026-06-01T00:00:00Z'),
        row('2026-11-20T00:00:00Z'),
        { facts: { version: 1 } },
        row('not a time'),
        row('2026-11-12T03:00:00Z')
      ],
      sydney
    )!
    expect(map.emails).toBe(1)
    expect(sendTimeMap([], sydney)).toBeNull()
    expect(
      sendTimeMap([row('2026-11-12T03:00:00Z')], { now, timezone: 'Mars/Base' })
    ).toBeNull()
  })

  it('names up to three usual slots seen at least twice, most first', () => {
    const map = sendTimeMap(
      [
        ...['2026-11-02', '2026-10-26', '2026-10-19'].map((d) =>
          row(`${d}T23:00:00Z`)
        ),
        ...['2026-11-04', '2026-10-28'].map((d) => row(`${d}T07:00:00Z`)),
        ...['2026-11-06', '2026-10-30'].map((d) => row(`${d}T08:00:00Z`)),
        ...['2026-11-07', '2026-10-31'].map((d) => row(`${d}T09:00:00Z`)),
        row('2026-11-08T10:00:00Z')
      ],
      sydney
    )!
    expect(map.usual).toEqual([
      { day: 'Tue', hour: 10, emails: 3 },
      { day: 'Wed', hour: 18, emails: 2 },
      { day: 'Fri', hour: 19, emails: 2 }
    ])
  })

  it('names quiet days only from enough emails', () => {
    // 14 weekday emails over two weeks: no weekend sends.
    const days = [
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29'
    ]
    const utcNow = { now: Date.parse('2026-11-15T12:00:00Z'), timezone: 'UTC' }
    expect(
      sendTimeMap(
        days.map((d) => row(`${d}T10:00:00Z`)),
        utcNow
      )!.quietDays
    ).toEqual(['Sat', 'Sun'])
    expect(
      sendTimeMap(
        days.slice(0, 13).map((d) => row(`${d}T10:00:00Z`)),
        utcNow
      )!.quietDays
    ).toEqual([])
  })
})
