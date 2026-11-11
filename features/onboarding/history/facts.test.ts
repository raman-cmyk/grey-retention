// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { sampleAsk, type Ask, type AiRun } from '@/features/intelligence/passes'
import type { CampaignMessage } from '@/lib/providers/klaviyo/history'
import {
  audienceList,
  bestEmails,
  cadence,
  flowResults,
  historySnapshot,
  localParts,
  offerWords,
  scheduledEmails,
  sentEmails,
  windowRead,
  zoneOr,
  type HistorySnapshot
} from './facts'
import {
  historian,
  historianInput,
  readHistory,
  sampleHistory
} from './historian'
import { planFromHistory, readKlaviyoHistory, unknownAudience } from './read'

const now = Date.parse('2026-11-11T12:00:00Z')
const day = 86_400_000
const iso = (daysAgo: number, hourUtc = 18) =>
  new Date(
    Math.floor((now - daysAgo * day) / day) * day + hourUtc * 3_600_000
  ).toISOString()
const message = (over: Partial<CampaignMessage>): CampaignMessage => ({
  id: 'M1',
  campaignId: 'C1',
  campaignName: 'Campaign',
  archived: false,
  name: 'Message',
  status: 'sent',
  sendAt: iso(3),
  strategy: 'static',
  channel: 'email',
  subject: 'Hello',
  preview: null,
  contentKnown: true,
  abTest: false,
  ...over
})

describe('the counted history', () => {
  it('keeps sent emails only (no SMS, nothing not yet sent), newest first, with their results', () => {
    const sent = sentEmails(
      [
        message({ id: 'A', sendAt: iso(10) }),
        message({ id: 'B', sendAt: iso(2) }),
        message({ id: 'S', channel: 'sms' }),
        message({ id: 'F', sendAt: new Date(now + day).toISOString() }),
        message({ id: 'N', sendAt: null }),
        message({ id: 'U', channel: null, subject: null }),
        message({ id: 'R', channel: null, subject: null, sendAt: iso(20) }),
        message({ id: 'X', archived: true, sendAt: iso(30), abTest: true })
      ],
      [
        {
          groupings: { campaign_message_id: 'B' },
          statistics: {
            recipients: 1000.4,
            conversion_value: 123.456,
            open_rate: 0.412345,
            revenue_per_recipient: 0.123
          }
        },
        // A message of unknown channel the email report counts is an email.
        {
          groupings: { campaign_message_id: 'R' },
          statistics: { recipients: 5 }
        }
      ],
      now
    )
    expect(sent.map((e) => e.id)).toEqual(['B', 'A', 'R', 'X'])
    expect(sent[0]).toMatchObject({
      recipients: 1000,
      revenue: 123.46,
      openRate: 0.4123,
      revenuePerRecipient: 0.12,
      // Two days ago: its orders are still coming in.
      collecting: true
    })
    expect(sent[1]).toMatchObject({
      recipients: null,
      revenue: null,
      collecting: false
    })
    // An archived campaign was still sent; an A/B test is marked.
    expect(sent[3]).toMatchObject({ id: 'X', abTest: true })
  })

  it('keeps at most the newest 300 sent emails', () => {
    const sent = sentEmails(
      Array.from({ length: 320 }, (_, i) =>
        message({ id: `M${i}`, sendAt: iso(1 + i) })
      ),
      [],
      now
    )
    expect(sent).toHaveLength(windowRead.sentCap)
    expect(sent.at(-1)!.id).toBe('M299')
  })

  it('tells an offer from words that only look like one', () => {
    for (const offer of [
      '20% off knitwear',
      'Save $10 today',
      'Take 15% this weekend',
      '$5 off your order',
      'Use code KNIT20',
      'Free shipping over $75',
      'Our winter sale',
      'A coupon for you',
      'Buy one, get one'
    ])
      expect(offerWords.test(offer), offer).toBe(true)
    for (const plain of [
      '100% merino',
      'Kick off the season',
      'Our dress code for winter',
      'Off we go to the mill',
      'Saved by the knit'
    ])
      expect(offerWords.test(plain), plain).toBe(false)
  })

  it('counts emails a week over the last 8 weeks and the usual hour, in the store time', () => {
    const sent = sentEmails(
      [1, 4, 8, 11, 15, 18, 70].map((d, i) =>
        message({ id: `M${i}`, sendAt: iso(d) })
      ),
      [],
      now
    )
    expect(cadence(sent, 'Asia/Kathmandu', now)).toEqual({
      sendsPerWeek: 0.8,
      usualSendTime: '23:00'
    })
    expect(cadence([], 'UTC', now)).toEqual({
      sendsPerWeek: 0,
      usualSendTime: null
    })
    expect(localParts('2026-11-10T18:00:00Z', 'America/Los_Angeles')).toEqual({
      date: '2026-11-10',
      hour: 10,
      weekday: 'Tue'
    })
    expect(zoneOr('Not/AZone')).toBe('UTC')
    expect(zoneOr(null)).toBe('UTC')
  })

  it("counts a local-time send by its clock hour and a send at Klaviyo's times not at all", () => {
    const sent = sentEmails(
      [
        // 10:00 in each recipient's timezone (stored as 10:00 UTC).
        message({ id: 'L1', sendAt: iso(2, 10), strategy: 'local' }),
        message({ id: 'L2', sendAt: iso(9, 10), strategy: 'local' }),
        // 18:00 UTC: 10:00 in Los Angeles.
        message({ id: 'S1', sendAt: iso(16, 18) }),
        message({ id: 'O1', sendAt: iso(5, 3), strategy: 'optimized' }),
        message({ id: 'O2', sendAt: iso(12, 3), strategy: 'optimized' }),
        message({ id: 'O3', sendAt: iso(19, 3), strategy: 'optimized' })
      ],
      [],
      now
    )
    // Six emails since the first, 19 days ago: 2.2 a week.
    expect(cadence(sent, 'America/Los_Angeles', now)).toEqual({
      sendsPerWeek: 2.2,
      usualSendTime: '10:00'
    })
    // A store that began sending lately: emails a week since the first.
    expect(
      cadence(
        sentEmails([message({ id: 'A', sendAt: iso(2) })], [], now),
        'UTC',
        now
      ).sendsPerWeek
    ).toBe(1)
  })

  it('ranks the best emails by revenue per recipient, with enough recipients, no longer collecting orders', () => {
    const sent = sentEmails(
      [
        ...['A', 'B', 'C'].map((id) => message({ id, sendAt: iso(10) })),
        message({ id: 'D', sendAt: iso(2) })
      ],
      [
        {
          groupings: { campaign_message_id: 'A' },
          statistics: { recipients: 50, revenue_per_recipient: 9 }
        },
        {
          groupings: { campaign_message_id: 'B' },
          statistics: { recipients: 500, revenue_per_recipient: 1 }
        },
        {
          groupings: { campaign_message_id: 'C' },
          statistics: { recipients: 500, revenue_per_recipient: 2 }
        },
        {
          groupings: { campaign_message_id: 'D' },
          statistics: { recipients: 500, revenue_per_recipient: 7 }
        }
      ],
      now
    )
    expect(bestEmails(sent).map((e) => e.id)).toEqual(['C', 'B'])
  })

  it('takes scheduled emails ahead only, on their local day, with their audience and whether they offer something', () => {
    const scheduled = scheduledEmails(
      [
        message({
          id: 'S1',
          status: 'scheduled',
          sendAt: '2026-11-13T07:30:00Z',
          subject: 'Winter layers'
        }),
        message({
          id: 'S2',
          status: 'scheduled',
          sendAt: '2026-11-14T18:00:00Z',
          campaignId: 'C2',
          subject: 'Save 25%'
        }),
        message({ id: 'S3', status: 'scheduled', sendAt: iso(1) }),
        message({
          id: 'S4',
          status: 'scheduled',
          sendAt: '2026-11-15T18:00:00Z',
          channel: 'sms'
        }),
        // An archived campaign never goes out.
        message({
          id: 'S5',
          status: 'scheduled',
          sendAt: '2026-11-16T18:00:00Z',
          archived: true
        }),
        // Unknown channel, no subject: not known to be an email.
        message({
          id: 'S6',
          status: 'scheduled',
          sendAt: '2026-11-17T18:00:00Z',
          channel: null,
          subject: null
        })
      ],
      [{ campaignId: 'C2', included: ['SegVIP'], excluded: [] }],
      'America/Los_Angeles',
      now
    )
    expect(
      scheduled.map((e) => [e.id, e.date, e.audienceIds, e.offer])
    ).toEqual([
      ['S1', '2026-11-12', [], false],
      ['S2', '2026-11-14', ['SegVIP'], true]
    ])
  })

  it("adds up each flow's messages; unknown when the report was not read", () => {
    const flows = [
      { id: 'F1', name: 'Cart', status: 'live', trigger: 'Metric' },
      { id: 'F2', name: 'Welcome', status: 'live', trigger: 'Added to List' }
    ]
    expect(
      flowResults(
        flows,
        [
          {
            groupings: { flow_id: 'F1' },
            statistics: {
              recipients: 10,
              conversions: 1,
              conversion_value: 5.555
            }
          },
          {
            groupings: { flow_id: 'F1' },
            statistics: { recipients: 5, conversions: 2, conversion_value: 1 }
          },
          { groupings: { flow_id: 'F9' }, statistics: { recipients: 99 } }
        ],
        true
      )
    ).toEqual([
      {
        id: 'F1',
        name: 'Cart',
        status: 'live',
        trigger: 'Metric',
        sends90d: 15,
        orders90d: 3,
        revenue90d: 6.56
      },
      // Not in the report: it sent nothing.
      {
        id: 'F2',
        name: 'Welcome',
        status: 'live',
        trigger: 'Added to List',
        sends90d: 0,
        orders90d: 0,
        revenue90d: 0
      }
    ])
    expect(
      flowResults(flows, [], false).map((f) => [f.sends90d, f.revenue90d])
    ).toEqual([
      [null, null],
      [null, null]
    ])
  })

  it('marks a list the scheduled emails only leave out', () => {
    const groups = [
      {
        id: 'LstSuppr',
        kind: 'list',
        name: 'Do not email',
        active: true,
        starred: false
      },
      {
        id: 'LstNews',
        kind: 'list',
        name: 'Newsletter',
        active: true,
        starred: false
      },
      {
        id: 'SegEng',
        kind: 'segment',
        name: 'Engaged',
        active: true,
        starred: true
      }
    ] as const
    expect(
      audienceList(
        [...groups],
        [
          {
            campaignId: 'C1',
            included: ['SegEng'],
            excluded: ['LstSuppr', 'LstNews']
          },
          { campaignId: 'C2', included: ['LstNews'], excluded: ['LstSuppr'] }
        ]
      ).map((a) => [a.id, a.excludedOnly])
    ).toEqual([
      ['SegEng', false],
      ['LstSuppr', true],
      ['LstNews', false]
    ])
  })
})

const snapshot = (over: Partial<HistorySnapshot> = {}): HistorySnapshot =>
  historySnapshot.parse({
    currency: 'USD',
    timezone: 'America/Los_Angeles',
    sendsPerWeek: 5.4,
    usualSendTime: '05:00',
    sent: sentEmails(
      [message({ id: 'A', subject: 'Twenty off', sendAt: iso(6) })],
      [
        {
          groupings: { campaign_message_id: 'A' },
          statistics: {
            recipients: 900,
            revenue_per_recipient: 2,
            clicks_unique: 40,
            conversion_value: 1800
          }
        }
      ],
      now
    ),
    scheduled: [
      {
        id: 'S1',
        campaignId: 'C1',
        subject: 'x',
        sendAt: '2026-11-20T18:00:00.000Z',
        date: '2026-11-20',
        audienceIds: ['SegA'],
        offer: true
      },
      {
        id: 'S2',
        campaignId: 'C2',
        subject: 'y',
        sendAt: '2026-12-20T18:00:00.000Z',
        date: '2026-12-20',
        audienceIds: ['SegA'],
        offer: false
      },
      {
        id: 'S3',
        campaignId: 'C3',
        subject: 'z',
        sendAt: '2026-11-21T18:00:00.000Z',
        date: '2026-11-21',
        audienceIds: [],
        offer: false
      }
    ],
    flows: [],
    audiences: [
      {
        id: 'SegA',
        kind: 'segment',
        name: 'Engaged',
        active: true,
        starred: true,
        excludedOnly: false
      },
      {
        id: 'SegB',
        kind: 'segment',
        name: 'Old',
        active: false,
        starred: false,
        excludedOnly: false
      },
      {
        id: 'LstSup',
        kind: 'list',
        name: 'Do not email',
        active: true,
        starred: false,
        excludedOnly: true
      }
    ],
    flowsRead: true,
    window: windowRead,
    parts: {
      sent: true,
      scheduled: true,
      audiences: true,
      campaignReport: true,
      flows: true,
      flowReport: true,
      lists: true,
      segments: true
    },
    ...over
  })

describe('planFromHistory', () => {
  it('gives emails a week within 2 to 4, a send time within the send hours, and the scheduled days in the window', () => {
    const plan = planFromHistory(snapshot(), { start: '2026-11-12', days: 15 })
    expect(plan).toEqual({
      sendsPerWeek: 4,
      sendTime: '07:00',
      // Never a suppression list, never an inactive segment.
      audiences: [{ id: 'SegA', label: 'Engaged' }],
      // The email sent 7 days before the window counts against its first
      // week; a scheduled one with no known audience still takes its day.
      existing: [
        { date: '2026-11-05', audienceId: unknownAudience, offer: false },
        { date: '2026-11-20', audienceId: 'SegA', offer: true },
        { date: '2026-11-21', audienceId: unknownAudience, offer: false }
      ],
      results: [
        {
          title: 'Twenty off',
          sentOn: '2026-11-05',
          clicks: 40,
          revenue: 1800
        }
      ]
    })
    expect(
      planFromHistory(snapshot({ sendsPerWeek: 0.2, usualSendTime: null }), {
        start: '2026-11-12',
        days: 15
      })
    ).toMatchObject({ sendsPerWeek: 2, sendTime: null })
  })

  it('takes at most 50 audiences, starred and segments first', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `Lst${i}`,
      kind: 'list' as const,
      name: `List ${i}`,
      active: true,
      starred: false,
      excludedOnly: false
    }))
    const plan = planFromHistory(
      snapshot({
        audiences: [
          ...many,
          {
            id: 'SegZ',
            kind: 'segment',
            name: 'Zed',
            active: true,
            starred: false,
            excludedOnly: false
          },
          {
            id: 'LstStar',
            kind: 'list',
            name: 'Starred',
            active: true,
            starred: true,
            excludedOnly: false
          }
        ]
      }),
      { start: '2026-11-12', days: 15 }
    )
    expect(plan.audiences).toHaveLength(50)
    expect(plan.audiences.slice(0, 2).map((a) => a.id)).toEqual([
      'LstStar',
      'SegZ'
    ])
  })
})

describe('readKlaviyoHistory', () => {
  const db = (data: unknown, error: unknown = null) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data, error })
    }
    return { from: () => chain } as unknown as Parameters<
      typeof readKlaviyoHistory
    >[0]
  }
  it('reads the stored history, checked; nothing for none or a shape it does not know', async () => {
    const stored = await readKlaviyoHistory(
      db({
        snapshot: snapshot(),
        read_at: '2026-11-11T12:00:00Z',
        complete: true,
        live: false
      }),
      't'
    )
    expect(stored).toMatchObject({
      complete: true,
      live: false,
      history: { currency: 'USD' }
    })
    expect(await readKlaviyoHistory(db(null), 't')).toBeNull()
    expect(
      await readKlaviyoHistory(
        db({
          snapshot: { sent: 'x' },
          read_at: '',
          complete: true,
          live: false
        }),
        't'
      )
    ).toBeNull()
    await expect(
      readKlaviyoHistory(db(null, { code: '42501' }), 't')
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('the Klaviyo historian', () => {
  const history = snapshot()
  const input = historianInput('Cedar Goods', history)
  const answering = (run: AiRun) => vi.fn(async () => run) as unknown as Ask

  it('sees the best and the latest emails, the live flows and the active audiences, as data', () => {
    expect(input.best.map((e) => e.id)).toEqual(['A'])
    expect(input.audiences).toEqual(['Engaged'])
    expect(JSON.parse(historian.task(input)).brand).toBe('Cedar Goods')
    expect(historian).toMatchObject({
      purpose: 'review',
      temperature: 0,
      reasoningEffort: 'none'
    })
  })

  it('uses the sample rules when the AI is the fake', async () => {
    expect(await readHistory(input, history, sampleAsk, 'k')).toEqual({
      answered: true,
      findings: sampleHistory(history),
      pass: 'sample',
      model: null
    })
    expect(sampleHistory(history)[0]).toMatchObject({
      topic: 'audience',
      statement: 'Emails go to segments such as Engaged.'
    })
  })

  it('says why there are no words, and never throws', async () => {
    for (const [run, reason] of [
      [{ ok: false, code: 'incomplete' }, 'answer_too_long'],
      [{ ok: false, code: 'refused' }, 'model_refused'],
      [{ ok: false, code: 'cap_reached' }, 'budget_spent'],
      [{ ok: false, code: 'unavailable' }, 'model_failed'],
      [
        {
          ok: true,
          provider: 'gemini',
          model: 'm',
          content: { findings: 'x' }
        },
        'model_unusable'
      ]
    ] as [AiRun, string][])
      expect(await readHistory(input, history, answering(run), 'k')).toEqual({
        answered: false,
        reason
      })
  })
})
