// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { emailSections } from './sections'
import {
  afterStatus,
  dayMs,
  designOf,
  hourMs,
  resultsPatch,
  sampleResults,
  sampleStatus,
  statusOf,
  type ResultRow
} from './sync'

const now = Date.parse('2026-11-20T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const row = (over: Partial<ResultRow> = {}): ResultRow => ({
  tenant_id: 't1',
  build_id: 'b1',
  run_id: 'r1',
  slot: 0,
  sample: false,
  campaign_id: 'CmpR01',
  message_id: 'MsgR01',
  planned: {
    date: '2026-11-18',
    time: '18:00',
    plannedSendAt: '2026-11-18T18:00:00.000Z'
  },
  status: 'draft',
  changed: false,
  sent_at: null,
  checked_at: null,
  next_check_at: iso(now),
  pulls: 0,
  results: [],
  clicks: [],
  results_at: null,
  complete: true,
  final: false,
  paused: null,
  lease_token: 'lease',
  lease_until: iso(now + 60_000),
  created_at: iso(now - dayMs),
  updated_at: iso(now - dayMs),
  ...over
})
const seen = (
  status: string,
  sendTime: string | null = null,
  changed = false
) => ({ found: true, status, sendTime, changed }) as const

describe('a status check', () => {
  it('looks at a draft or a scheduled email again in an hour', () => {
    for (const s of ['draft', 'Scheduled', 'sending'])
      expect(afterStatus(row(), seen(s), now)).toEqual({
        patch: {
          status: statusOf(s)!,
          next_check_at: iso(now + hourMs)
        },
        pullDue: false
      })
  })

  it('marks an email changed outside the app, and still looks at it', () => {
    expect(afterStatus(row(), seen('draft', null, true), now).patch).toEqual({
      status: 'draft',
      changed: true,
      next_check_at: iso(now + hourMs)
    })
  })

  it('ends with a deleted or a cancelled email', () => {
    expect(afterStatus(row(), { found: false }, now).patch).toEqual({
      status: 'deleted',
      final: true,
      next_check_at: iso(now)
    })
    expect(afterStatus(row(), seen('cancelled'), now).patch).toMatchObject({
      status: 'cancelled',
      final: true
    })
  })

  it('keeps the send time Klaviyo gives, and reads results a day after it', () => {
    const sentAt = now - 2 * hourMs
    expect(afterStatus(row(), seen('sent', iso(sentAt)), now)).toEqual({
      patch: {
        status: 'sent',
        sent_at: iso(sentAt),
        next_check_at: iso(sentAt + dayMs)
      },
      pullDue: false
    })
    // A day on: the first read is due.
    const sent = row({ status: 'sent', sent_at: iso(sentAt) })
    expect(
      afterStatus(sent, seen('sent', iso(sentAt)), sentAt + dayMs).pullDue
    ).toBe(true)
    // After three reads, none more.
    expect(
      afterStatus(
        { ...sent, pulls: 3 },
        seen('sent', iso(sentAt)),
        sentAt + 9 * dayMs
      ).pullDue
    ).toBe(false)
  })

  it('never takes a send time from the future, and never a second one', () => {
    expect(
      afterStatus(row(), seen('sent', iso(now + dayMs)), now).patch.sent_at
    ).toBe(iso(now))
    const sent = row({ status: 'sent', sent_at: iso(now - hourMs) })
    expect(
      afterStatus(sent, seen('sent', iso(now - 5 * hourMs)), now).patch
    ).not.toHaveProperty('sent_at')
  })

  it('never goes back from sent or cancelled, and keeps ours for a status it does not know', () => {
    const sent = row({ status: 'sent', sent_at: iso(now - hourMs) })
    expect(afterStatus(sent, seen('draft'), now).patch.status).toBe('sent')
    expect(
      afterStatus(row({ status: 'scheduled' }), seen('paused_by_klaviyo'), now)
        .patch.status
    ).toBe('scheduled')
  })

  it('calls a draft stale two weeks after its day, never sooner', () => {
    const old = row({ planned: { date: '2026-11-01' } })
    expect(
      afterStatus(old, seen('draft'), Date.parse('2026-11-15T12:00:00Z')).patch
        .status
    ).toBe('draft')
    expect(
      afterStatus(old, seen('draft'), Date.parse('2026-11-17T00:00:01Z')).patch
    ).toMatchObject({ status: 'stale', final: true })
  })
})

describe('a results read', () => {
  const html =
    '<table><tr data-block="hero_product"><td><a href="https://shop.example/p/1">A</a></td></tr>' +
    '<tr data-block="product_grid"><td><a href="https://shop.example/p/2">B</a></td></tr></table>'
  const sections = emailSections(html)
  const sentAt = iso(now - dayMs)
  const templates = [
    { approach: 'A', id: 'T1', variation: 'VarA01', deleted: false },
    { approach: 'B', id: 'T2', variation: 'VarB01', deleted: false }
  ]

  it('stores each design’s results and each link’s clicks under its section', () => {
    const patch = resultsPatch(
      row({ status: 'sent', sent_at: sentAt }),
      sentAt,
      {
        results: [
          {
            campaignId: 'CmpR01',
            messageId: 'MsgR01',
            variationId: 'VarB01',
            variationName: 'Variation 2',
            statistics: { recipients: 100, open_rate: 0.4 }
          }
        ],
        clicks: [
          {
            variationId: 'VarB01',
            url: 'https://shop.example/p/2?utm_source=klaviyo',
            clicks: 5,
            unique: 4
          },
          {
            variationId: 'VarB01',
            url: 'https://manage.kmail-lists.com/u',
            clicks: 1,
            unique: 1
          },
          { variationId: null, url: 'mailto:x@y.example', clicks: 1, unique: 1 }
        ],
        complete: true,
        templates,
        sections
      },
      now
    )
    expect(patch).toEqual({
      status: 'sent',
      pulls: 1,
      results: [
        {
          variation: 'VarB01',
          name: 'Variation 2',
          design: 'B',
          statistics: { recipients: 100, open_rate: 0.4 }
        }
      ],
      clicks: [
        {
          variation: 'VarB01',
          url: 'https://shop.example/p/2?utm_source=klaviyo',
          section: 1,
          block: 'product_grid',
          clicks: 5,
          unique: 4
        },
        {
          variation: 'VarB01',
          url: 'https://manage.kmail-lists.com/u',
          section: null,
          block: null,
          clicks: 1,
          unique: 1
        }
      ],
      complete: true,
      final: false,
      next_check_at: iso(Date.parse(sentAt) + 2 * dayMs)
    })
  })

  it('ends after the third read', () => {
    const patch = resultsPatch(
      row({ status: 'sent', sent_at: sentAt, pulls: 2 }),
      sentAt,
      { results: [], clicks: [], complete: true, templates, sections },
      now
    )
    expect(patch).toMatchObject({ pulls: 3, final: true })
  })

  it('names our design from the template we put on it, else from its name', () => {
    expect(designOf(templates, 'VarA01', 'Variation 1')).toBe('A')
    expect(
      designOf(
        [{ approach: 'B', variation: 'VarB01', deleted: true }],
        'VarB01',
        'Design A'
      )
    ).toBe('A')
    expect(designOf([], 'VarZ', 'Something')).toBeNull()
  })
})

describe('a synthetic brand’s sample draft', () => {
  const sample = row({ sample: true, message_id: null })
  const html =
    '<table><tr data-block="hero_product"><td><a href="https://cedar-lane.example/p/1">A</a></td></tr></table>'

  it('is a draft until its planned send time, then sent at it', () => {
    expect(sampleStatus(sample, Date.parse('2026-11-18T17:00:00Z'))).toEqual({
      found: true,
      status: 'draft',
      sendTime: '2026-11-18T18:00:00.000Z',
      changed: false
    })
    expect(sampleStatus(sample, now)).toMatchObject({
      status: 'sent',
      sendTime: '2026-11-18T18:00:00.000Z'
    })
  })

  it('has the same results each time, growing over its three days', () => {
    const sections = emailSections(html)
    const days = [0, 1, 2].map((pulls) =>
      sampleResults({ ...sample, pulls }, sections)
    )
    expect(sampleResults(sample, sections)).toEqual(days[0])
    const opens = days.map((d) => d.results[0]!.statistics.opens_unique!)
    expect(opens[0]).toBeLessThan(opens[1]!)
    expect(opens[1]).toBeLessThan(opens[2]!)
    for (const d of days) {
      const s = d.results[0]!.statistics
      expect(s.open_rate).toBeGreaterThan(0)
      expect(s.open_rate).toBeLessThanOrEqual(1)
      expect(d.clicks[0]!.url).toBe('https://cedar-lane.example/p/1')
    }
    // Another email, other numbers.
    expect(
      sampleResults({ ...sample, build_id: 'b2' }, sections).results[0]!
        .statistics.recipients
    ).not.toBe(days[0]!.results[0]!.statistics.recipients)
  })
})
