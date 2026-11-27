import { describe, expect, it } from 'vitest'
import {
  engagement,
  resolveSendTimes,
  sendSamples,
  sendTimeEntry,
  sendTimeRules,
  sendTimes,
  storeWide,
  type SendSample
} from './send-times'
import type { SentEmail } from './facts'

const now = Date.parse('2026-11-26T12:00:00Z')
const zone = 'America/New_York'

/** A send at `iso`, to `audiences`, with its results. */
const send = (
  iso: string,
  audiences: string[],
  over: Partial<SendSample> = {}
): SendSample => ({
  sentAt: iso,
  strategy: 'static',
  recipients: 1000,
  opens: 300,
  clicks: 20,
  audienceIds: audiences,
  ...over
})
const of = (rows: ReturnType<typeof sendTimes>, id: string) =>
  rows.find((r) => r.audienceId === id)!

describe('sendTimes (PICK-97)', () => {
  it('gives each audience the hour its people open and click most, in store time', () => {
    const rows = sendTimes(
      [
        // 9:00 in New York (EST, UTC-5): few clicks.
        send('2026-11-02T14:00:00Z', ['SegA'], { clicks: 10 }),
        send('2026-11-09T14:00:00Z', ['SegA'], { clicks: 12 }),
        // 18:00 in New York: more clicks.
        send('2026-11-04T23:00:00Z', ['SegA'], { clicks: 40 }),
        send('2026-11-11T23:00:00Z', ['SegA'], { clicks: 44 })
      ],
      zone,
      now
    )
    const a = of(rows, 'SegA')
    expect(a).toMatchObject({
      bestHour: 18,
      compared: true,
      reason: 'enough',
      // 4 and 11 Nov are Wednesdays, 2 and 9 Nov Mondays.
      bestWeekday: 'Wed'
    })
    expect(a.facts).toMatchObject({
      sends: 4,
      leftOut: 0,
      recipients: 4000,
      opens: 1200,
      clicks: 106,
      firstSentAt: '2026-11-02T14:00:00Z',
      lastSentAt: '2026-11-11T23:00:00Z'
    })
    expect(a.facts.hours.map((h) => [h.hour, h.sends])).toEqual([
      [9, 2],
      [18, 2]
    ])
    // The facts and the recommendation fit the stored shape.
    expect(sendTimeEntry.safeParse(a).success).toBe(true)
    // The store's row counts every send.
    expect(rows[0]).toMatchObject({ audienceId: storeWide, bestHour: 18 })
  })

  it('needs three counted sends, and an hour tried twice: otherwise "not enough history"', () => {
    const two = sendTimes(
      [
        send('2026-11-02T14:00:00Z', ['SegA']),
        send('2026-11-09T14:00:00Z', ['SegA'])
      ],
      zone,
      now
    )
    expect(of(two, 'SegA')).toMatchObject({
      bestHour: null,
      bestWeekday: null,
      compared: false,
      reason: 'few_sends'
    })
    // Three sends, each at another hour: no hour was tried enough.
    const spread = sendTimes(
      [
        send('2026-11-02T14:00:00Z', ['SegA']),
        send('2026-11-03T16:00:00Z', ['SegA']),
        send('2026-11-04T19:00:00Z', ['SegA'])
      ],
      zone,
      now
    )
    expect(of(spread, 'SegA')).toMatchObject({
      bestHour: null,
      reason: 'no_repeated_time',
      compared: false
    })
    // Three at one hour: that hour, but nothing was compared.
    const same = sendTimes(
      [
        send('2026-11-02T14:00:00Z', ['SegA']),
        send('2026-11-03T14:00:00Z', ['SegA']),
        send('2026-11-04T14:00:00Z', ['SegA'])
      ],
      zone,
      now
    )
    expect(of(same, 'SegA')).toMatchObject({
      bestHour: 9,
      compared: false,
      reason: 'enough'
    })
    for (const r of [...two, ...spread, ...same])
      expect(sendTimeEntry.safeParse(r).success).toBe(true)
  })

  it('leaves out per-person times, small sends, sends without results and those still collecting opens', () => {
    const rows = sendTimes(
      [
        send('2026-11-02T14:00:00Z', ['SegA'], { strategy: 'optimized' }),
        send('2026-11-03T14:00:00Z', ['SegA'], { recipients: 40 }),
        send('2026-11-04T14:00:00Z', ['SegA'], { opens: null }),
        send('2026-11-05T14:00:00Z', ['SegA'], { clicks: null }),
        send('2026-11-06T14:00:00Z', ['SegA'], { recipients: null }),
        // A day ago: its opens are still coming in.
        send('2026-11-25T14:00:00Z', ['SegA']),
        send('2026-11-09T14:00:00Z', ['SegA'])
      ],
      zone,
      now
    )
    expect(of(rows, 'SegA')).toMatchObject({
      reason: 'few_sends',
      facts: { sends: 1, leftOut: 6 }
    })
  })

  it('reads the hour across a daylight-saving change: 9:00 local is 9:00 in summer and winter', () => {
    const rows = sendTimes(
      [
        // EDT (UTC-4) before 2 Nov, EST (UTC-5) after.
        send('2026-10-26T13:00:00Z', ['SegA']),
        send('2026-10-30T13:00:00Z', ['SegA']),
        send('2026-11-02T14:00:00Z', ['SegA']),
        send('2026-11-06T14:00:00Z', ['SegA'])
      ],
      zone,
      now
    )
    expect(of(rows, 'SegA').facts.hours).toEqual([
      expect.objectContaining({ hour: 9, sends: 4 })
    ])
    // The same moments read in UTC are two different hours.
    const utc = sendTimes(
      [
        send('2026-10-26T13:00:00Z', ['SegA']),
        send('2026-11-02T14:00:00Z', ['SegA'])
      ],
      'UTC',
      now
    )
    expect(of(utc, 'SegA').facts.hours.map((h) => h.hour)).toEqual([13, 14])
  })

  it('reads a send at each person’s own clock time by that clock hour', () => {
    const rows = sendTimes(
      [
        send('2026-11-02T11:00:00Z', ['SegA'], { strategy: 'local' }),
        send('2026-11-03T11:00:00Z', ['SegA'], { strategy: 'local' }),
        send('2026-11-04T11:00:00Z', ['SegA'], { strategy: 'local' })
      ],
      zone,
      now
    )
    expect(of(rows, 'SegA').bestHour).toBe(11)
  })

  it('weights clicks over opens, and takes off opens flagged as Apple privacy (machine) opens', () => {
    // 9:00 has many opens but few clicks; 18:00 fewer opens, more clicks.
    const opensOnly = [
      send('2026-11-02T14:00:00Z', ['SegA'], { opens: 600, clicks: 5 }),
      send('2026-11-09T14:00:00Z', ['SegA'], { opens: 600, clicks: 5 }),
      send('2026-11-04T23:00:00Z', ['SegA'], { opens: 250, clicks: 45 }),
      send('2026-11-11T23:00:00Z', ['SegA'], { opens: 250, clicks: 45 })
    ]
    expect(of(sendTimes(opensOnly, zone, now), 'SegA').bestHour).toBe(18)
    // Opens decide when clicks are equal, without machine opens.
    const flagged = [
      send('2026-11-02T14:00:00Z', ['SegA'], {
        opens: 700,
        machineOpens: 500
      }),
      send('2026-11-09T14:00:00Z', ['SegA'], {
        opens: 700,
        machineOpens: 500
      }),
      send('2026-11-04T23:00:00Z', ['SegA'], { opens: 400 }),
      send('2026-11-11T23:00:00Z', ['SegA'], { opens: 400 })
    ]
    const r = of(sendTimes(flagged, zone, now), 'SegA')
    expect(r.bestHour).toBe(18)
    expect(r.facts.machineOpens).toBe(1000)
    // Unflagged, the inflated opens would have won.
    const unflagged = flagged.map((s) => ({ ...s, machineOpens: null }))
    expect(of(sendTimes(unflagged, zone, now), 'SegA').bestHour).toBe(9)
    expect(
      engagement({
        sends: 1,
        recipients: 100,
        opens: 10,
        clicks: 1,
        machineOpens: 50
      })
    ).toBe(sendTimeRules.clickWeight / 100)
  })

  it('never recommends an hour outside the send hours', () => {
    const rows = sendTimes(
      [
        // 23:00 in New York: the most clicks, but outside 07 to 21.
        send('2026-11-03T04:00:00Z', ['SegA'], { clicks: 90 }),
        send('2026-11-04T04:00:00Z', ['SegA'], { clicks: 90 }),
        send('2026-11-05T14:00:00Z', ['SegA']),
        send('2026-11-06T14:00:00Z', ['SegA'])
      ],
      zone,
      now
    )
    expect(of(rows, 'SegA')).toMatchObject({ bestHour: 9, compared: false })
    expect(of(rows, 'SegA').facts.hours.map((h) => h.hour)).toEqual([9, 23])
  })

  it('counts a send for every audience it went to, and keeps the store row first', () => {
    const rows = sendTimes(
      [
        send('2026-11-02T14:00:00Z', ['SegA', 'SegB', 'SegA']),
        send('2026-11-03T14:00:00Z', ['SegB', 'bad id'])
      ],
      zone,
      now
    )
    expect(rows.map((r) => [r.audienceId, r.facts.sends])).toEqual([
      ['*', 2],
      ['SegB', 2],
      ['SegA', 1]
    ])
  })
})

describe('sendSamples (PICK-97)', () => {
  it('joins each sent email to its campaign’s audiences; no machine opens are flagged by the report', () => {
    const e = {
      id: 'MsgA01',
      campaignId: 'CmpA01',
      sentAt: '2026-11-02T14:00:00Z',
      strategy: 'static',
      recipients: 1000,
      opens: 300,
      clicks: 20
    } as SentEmail
    expect(
      sendSamples(
        [e, { ...e, id: 'MsgA02', campaignId: null }],
        [{ campaignId: 'CmpA01', included: ['SegA'] }]
      )
    ).toEqual([
      expect.objectContaining({ audienceIds: ['SegA'], machineOpens: null }),
      expect.objectContaining({ audienceIds: [] })
    ])
  })
})

describe('resolveSendTimes (PICK-97)', () => {
  const rows = sendTimes(
    [
      send('2026-11-02T14:00:00Z', ['SegA']),
      send('2026-11-09T14:00:00Z', ['SegA']),
      send('2026-11-04T23:00:00Z', ['SegA', 'SegB'], { clicks: 60 }),
      send('2026-11-11T23:00:00Z', ['SegA'], { clicks: 60 })
    ],
    zone,
    now
  )

  it('uses the audience’s own time, then the store’s, then the usual hour, then the default', () => {
    expect(resolveSendTimes(['SegA', 'SegB'], rows, '10:00', '10:00')).toEqual([
      {
        audienceId: 'SegA',
        time: '18:00',
        basis: 'segment',
        compared: true,
        weekday: 'Wed'
      },
      // One send: not enough history; the store's best hour.
      {
        audienceId: 'SegB',
        time: '18:00',
        basis: 'store',
        compared: true,
        weekday: 'Wed'
      }
    ])
    const noStore = rows.map((r) =>
      r.audienceId === storeWide
        ? {
            ...r,
            bestHour: null,
            compared: false,
            reason: 'few_sends' as const
          }
        : r
    )
    expect(resolveSendTimes(['SegB'], noStore, '11:00', '10:00')).toEqual([
      {
        audienceId: 'SegB',
        time: '11:00',
        basis: 'usual',
        compared: false,
        weekday: null
      }
    ])
    expect(resolveSendTimes(['SegB'], null, null, '10:00')).toEqual([
      {
        audienceId: 'SegB',
        time: '10:00',
        basis: 'default',
        compared: false,
        weekday: null
      }
    ])
  })
})
