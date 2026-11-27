import { describe, expect, it } from 'vitest'
import {
  engagement,
  resolveSendTimes,
  sendSamples,
  sendTimeEntry,
  sendTimeRules,
  sendTimes,
  storeWide,
  strengthOf,
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
// 9:00 in New York (EST, UTC-5) on Mondays 2 and 9 Nov; 18:00 on
// Wednesdays 4 and 11 Nov.
const nine = ['2026-11-02T14:00:00Z', '2026-11-09T14:00:00Z']
const six = ['2026-11-04T23:00:00Z', '2026-11-11T23:00:00Z']

describe('sendTimes (PICK-97)', () => {
  it('gives an audience the hour its people open and click most, in store time, by a clear margin', () => {
    const rows = sendTimes(
      [
        ...nine.map((t) => send(t, ['SegA'], { clicks: 10 })),
        ...six.map((t) => send(t, ['SegA'], { clicks: 40 }))
      ],
      zone,
      now
    )
    const a = of(rows, 'SegA')
    expect(a).toMatchObject({
      bestHour: 18,
      rivals: 1,
      compared: true,
      reason: 'enough',
      bestWeekday: 'Wed'
    })
    expect(strengthOf(a)).toBe('clear')
    expect(a.facts).toMatchObject({
      sends: 4,
      leftOut: 0,
      shared: 0,
      within: ['SegA'],
      recipients: 4000,
      opens: 1200,
      clicks: 100,
      firstSentAt: '2026-11-02T14:00:00Z',
      lastSentAt: '2026-11-11T23:00:00Z'
    })
    expect(a.facts.hours.map((h) => [h.hour, h.sends])).toEqual([
      [9, 2],
      [18, 2]
    ])
    // The facts and the recommendation fit the stored shape.
    for (const r of rows) expect(sendTimeEntry.safeParse(r).success).toBe(true)
    expect(rows[0]).toMatchObject({ audienceId: storeWide, bestHour: 18 })
  })

  it('a best hour within the margin is not a clear winner: “the time that did best so far”', () => {
    const rows = sendTimes(
      [
        ...nine.map((t) => send(t, ['SegA'], { clicks: 20 })),
        ...six.map((t) => send(t, ['SegA'], { clicks: 21 }))
      ],
      zone,
      now
    )
    const a = of(rows, 'SegA')
    expect(a).toMatchObject({ bestHour: 18, rivals: 1, compared: false })
    expect(strengthOf(a)).toBe('close')
    // (210 + 300) / 1000 against (200 + 300) / 1000: 2% better, not 10%.
    expect(sendTimeRules.minMargin).toBe(0.1)
  })

  it('never compares hours across different people: an email to several audiences counts for none of them', () => {
    // The reviewer's case: "Engaged 30d" at 18:00, the full list at 10:00.
    // The engaged always do better; that says who, not when.
    const rows = sendTimes(
      [
        ...['2026-11-02', '2026-11-03', '2026-11-04'].map((d) =>
          send(`${d}T23:00:00Z`, ['SegEng30'], { clicks: 80 })
        ),
        ...['2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10'].map((d) =>
          send(`${d}T15:00:00Z`, ['LstAll'], { clicks: 10 })
        ),
        // To both at 13:00: neither's own.
        send('2026-11-11T18:00:00Z', ['LstAll', 'SegEng30'], { clicks: 90 }),
        send('2026-11-12T18:00:00Z', ['SegEng30', 'LstAll'], { clicks: 90 })
      ],
      zone,
      now
    )
    const engaged = of(rows, 'SegEng30')
    const all = of(rows, 'LstAll')
    // Each has only its own hour: no comparison, nothing claimed.
    expect(engaged).toMatchObject({
      bestHour: 18,
      rivals: 0,
      compared: false,
      facts: { sends: 3, shared: 2, within: ['SegEng30'] }
    })
    expect(all).toMatchObject({
      bestHour: 10,
      rivals: 0,
      compared: false,
      facts: { sends: 4, shared: 2 }
    })
    expect(strengthOf(engaged)).toBe('only')
    // The store compares hours within its most-sent audience set only:
    // the full list's 10:00, never "the engaged at 18:00 beat it".
    expect(rows[0]).toMatchObject({
      audienceId: storeWide,
      bestHour: 10,
      compared: false,
      facts: { sends: 4, shared: 5, within: ['LstAll'] }
    })
  })

  it('needs three counted sends, and an hour tried twice: otherwise "not enough history"', () => {
    const two = sendTimes(
      nine.map((t) => send(t, ['SegA'])),
      zone,
      now
    )
    expect(of(two, 'SegA')).toMatchObject({
      bestHour: null,
      bestWeekday: null,
      rivals: 0,
      compared: false,
      reason: 'few_sends'
    })
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
      reason: 'no_repeated_time'
    })
    // Three at one hour, one at another: that hour, compared with nothing.
    const same = sendTimes(
      [
        ...nine.map((t) => send(t, ['SegA'])),
        send('2026-11-03T14:00:00Z', ['SegA']),
        send('2026-11-04T23:00:00Z', ['SegA'])
      ],
      zone,
      now
    )
    const one = of(same, 'SegA')
    expect(one).toMatchObject({ bestHour: 9, rivals: 0, compared: false })
    expect(one.facts.hours).toHaveLength(2)
    for (const r of [...two, ...spread, ...same])
      expect(sendTimeEntry.safeParse(r).success).toBe(true)
  })

  it('says when every hour tried enough is outside the send hours', () => {
    // 23:00 in New York, three times.
    const rows = sendTimes(
      ['2026-11-03', '2026-11-04', '2026-11-05'].map((d) =>
        send(`${d}T04:00:00Z`, ['SegA'])
      ),
      zone,
      now
    )
    expect(of(rows, 'SegA')).toMatchObject({
      bestHour: null,
      reason: 'out_of_hours'
    })
    expect(sendTimeEntry.safeParse(of(rows, 'SegA')).success).toBe(true)
  })

  it('never recommends an hour outside the send hours when another fits', () => {
    const rows = sendTimes(
      [
        send('2026-11-03T04:00:00Z', ['SegA'], { clicks: 90 }),
        send('2026-11-04T04:00:00Z', ['SegA'], { clicks: 90 }),
        ...nine.map((t) => send(t, ['SegA']))
      ],
      zone,
      now
    )
    expect(of(rows, 'SegA')).toMatchObject({ bestHour: 9, rivals: 0 })
    expect(of(rows, 'SegA').facts.hours.map((h) => h.hour)).toEqual([9, 23])
  })

  it('leaves out per-person times, small sends, sends without results and those still collecting opens', () => {
    const rows = sendTimes(
      [
        send('2026-11-02T14:00:00Z', ['SegA'], { strategy: 'optimized' }),
        send('2026-11-03T14:00:00Z', ['SegA'], { recipients: 40 }),
        send('2026-11-04T14:00:00Z', ['SegA'], { opens: null }),
        send('2026-11-05T14:00:00Z', ['SegA'], { clicks: null }),
        send('2026-11-06T14:00:00Z', ['SegA'], { recipients: null }),
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
    expect(rows[0]!.facts).toMatchObject({ sends: 1, leftOut: 6 })
  })

  it('reads the hour across a daylight-saving change: 9:00 local is 9:00 in summer and winter', () => {
    const rows = sendTimes(
      [
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
      ['2026-11-02', '2026-11-03', '2026-11-04'].map((d) =>
        send(`${d}T11:00:00Z`, ['SegA'], { strategy: 'local' })
      ),
      zone,
      now
    )
    expect(of(rows, 'SegA').bestHour).toBe(11)
  })

  it('weights clicks over opens, and takes off opens flagged as Apple privacy (machine) opens', () => {
    const opensOnly = [
      ...nine.map((t) => send(t, ['SegA'], { opens: 600, clicks: 5 })),
      ...six.map((t) => send(t, ['SegA'], { opens: 250, clicks: 45 }))
    ]
    expect(of(sendTimes(opensOnly, zone, now), 'SegA').bestHour).toBe(18)
    const flagged = [
      ...nine.map((t) => send(t, ['SegA'], { opens: 700, machineOpens: 500 })),
      ...six.map((t) => send(t, ['SegA'], { opens: 400 }))
    ]
    const r = of(sendTimes(flagged, zone, now), 'SegA')
    expect(r.bestHour).toBe(18)
    expect(r.facts.machineOpens).toBe(1000)
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

  it('keeps very large counts (a big store) within the stored shape', () => {
    const rows = sendTimes(
      [...nine, '2026-11-03T14:00:00Z'].map((t) =>
        send(t, ['SegA'], {
          recipients: 2_000_000_000,
          opens: 900_000_000,
          clicks: 40_000_000
        })
      ),
      zone,
      now
    )
    expect(of(rows, 'SegA').facts.recipients).toBe(6_000_000_000)
    for (const r of rows) expect(sendTimeEntry.safeParse(r).success).toBe(true)
  })

  it('prefers a known audience set over sends whose audiences were not read', () => {
    const rows = sendTimes(
      [
        ...['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) =>
          send(`${d}T23:00:00Z`, [])
        ),
        ...['2026-11-09', '2026-11-10', '2026-11-11'].map((d) =>
          send(`${d}T14:00:00Z`, ['SegA'])
        )
      ],
      zone,
      now
    )
    expect(rows[0]).toMatchObject({
      bestHour: 9,
      facts: { within: ['SegA'], shared: 4 }
    })
    // With no audience known at all, the store row still counts them.
    const unknown = sendTimes(
      ['2026-11-02', '2026-11-03', '2026-11-04'].map((d) =>
        send(`${d}T23:00:00Z`, [])
      ),
      zone,
      now
    )
    expect(unknown).toHaveLength(1)
    expect(unknown[0]).toMatchObject({ bestHour: 18, facts: { within: [] } })
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
      ...nine.map((t) => send(t, ['SegA'])),
      ...six.map((t) => send(t, ['SegA'], { clicks: 60 })),
      send('2026-11-05T23:00:00Z', ['SegB'], { clicks: 60 })
    ],
    zone,
    now
  )

  it('uses the audience’s own time, then the store’s (never its weekday), then the usual hour, then the default', () => {
    expect(resolveSendTimes(['SegA', 'SegB'], rows, '10:00', '10:00')).toEqual([
      {
        audienceId: 'SegA',
        time: '18:00',
        basis: 'segment',
        strength: 'clear',
        othersTried: true,
        weekday: 'Wed'
      },
      {
        audienceId: 'SegB',
        time: '18:00',
        basis: 'store',
        strength: 'clear',
        othersTried: true,
        weekday: null
      }
    ])
    const noStore = rows.map((r) =>
      r.audienceId === storeWide
        ? {
            ...r,
            bestHour: null,
            bestWeekday: null,
            rivals: 0,
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
        strength: 'none',
        othersTried: false,
        weekday: null
      }
    ])
    expect(resolveSendTimes(['SegB'], noStore, null, '10:00')).toEqual([
      expect.objectContaining({ time: '10:00', basis: 'default' })
    ])
  })

  it('is null when nothing was counted yet: no time is changed or explained', () => {
    expect(resolveSendTimes(['SegA'], null, '10:00', '10:00')).toBeNull()
    expect(
      resolveSendTimes(
        ['SegA'],
        rows.filter((r) => r.audienceId !== storeWide),
        '10:00',
        '10:00'
      )
    ).toBeNull()
  })
})
