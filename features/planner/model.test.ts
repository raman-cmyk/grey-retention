import { describe, expect, it } from 'vitest'
import type {
  KlaviyoCampaign,
  KlaviyoSnapshot
} from '@/lib/providers/klaviyo-read'
import {
  filterEntries,
  filtersActive,
  plannerEntries,
  plannerHref,
  plannerMonth,
  plannerSummary,
  readPlannerQuery,
  type PlannerQuery
} from './model'

const now = new Date('2026-11-06T17:00:00Z')
const tz = 'America/New_York'
const query = (over: Partial<PlannerQuery> = {}): PlannerQuery => ({
  m: '2026-11',
  view: 'calendar',
  status: 'all',
  channel: 'all',
  history: false,
  ...over
})

type Local = Parameters<typeof plannerEntries>[0]['campaigns'][number]
const local = (over: Partial<Local>): Local => ({
  id: 'c1',
  title: 'Holiday gift guide',
  planned_at: '2026-11-20T15:00:00Z',
  channel: 'email_design',
  calendar_revision: 1,
  calendar_state: 'approved',
  copy_state: 'draft',
  design_state: 'unassigned',
  delivery_state: 'not_ready',
  synthetic: false,
  superseded_by_plan: null,
  ...over
})
const kCampaign = (over: Partial<KlaviyoCampaign>): KlaviyoCampaign => ({
  id: 'K1',
  name: 'Black Friday early access',
  localTime: false,
  sendStrategy: 'static',
  fromEmail: 'hello@example.com',
  status: 'sent',
  sendTime: '2026-11-03T14:00:00Z',
  subject: '',
  previewText: '',
  fromLabel: '',
  included: [],
  excluded: [],
  revenue30d: null,
  stats: null,
  templateName: '',
  html: '',
  created: '2026-10-01T00:00:00Z',
  updated: '2026-10-01T00:00:00Z',
  ...over
})
const snapshot = (campaigns: KlaviyoCampaign[]) =>
  ({ campaigns }) as unknown as KlaviyoSnapshot

describe('planner URL state', () => {
  it('reads filters and falls back safely', () => {
    expect(
      readPlannerQuery(
        {
          m: '2024-02',
          view: 'table',
          status: 'scheduled',
          channel: 'email_text'
        },
        tz,
        now
      )
    ).toEqual({
      m: '2024-02',
      view: 'table',
      status: 'scheduled',
      channel: 'email_text',
      history: false
    })
    expect(
      readPlannerQuery(
        { m: '2024-13', view: 'grid', status: 'pending', channel: 'sms' },
        tz,
        now
      )
    ).toEqual(query())
  })

  it('opens the table for the old list and history views', () => {
    expect(readPlannerQuery({ view: 'list' }, tz, now).view).toBe('table')
    expect(readPlannerQuery({ view: 'history' }, tz, now)).toMatchObject({
      view: 'table',
      history: true
    })
    expect(readPlannerQuery({ history: ['1', '0'] }, tz, now).history).toBe(
      true
    )
  })

  it('keeps every other filter when one changes', () => {
    const q = query({ status: 'draft', channel: 'email_text', history: true })
    expect(plannerHref(q, { m: '2026-12' })).toBe(
      '/campaign-agent?m=2026-12&status=draft&channel=email_text&history=1'
    )
    expect(plannerHref(q, { view: 'table', status: 'all' })).toBe(
      '/campaign-agent?m=2026-11&view=table&channel=email_text&history=1'
    )
    expect(filtersActive(q)).toBe(true)
    expect(filtersActive(query({ history: true }))).toBe(false)
  })
})

describe('planner entries', () => {
  it('shows this workspace AND Klaviyo, sorted, with the real time on hover', () => {
    const { entries, unscheduled } = plannerEntries({
      campaigns: [local({})],
      snapshot: snapshot([
        kCampaign({}),
        kCampaign({
          id: 'K2',
          name: 'Draft idea',
          status: 'draft',
          sendTime: null
        })
      ]),
      timezone: tz,
      now
    })
    expect(entries.map((e) => [e.source, e.name, e.status])).toEqual([
      ['klaviyo', 'Black Friday early access', 'sent'],
      ['workspace', 'Holiday gift guide', 'draft']
    ])
    expect(entries[0].href).toBe('/campaigns/klaviyo/K1?from=planner')
    expect(entries[0].tooltip).toMatch(
      /^Black Friday early access · Klaviyo sample: Sent .+ \(.+\)$/
    )
    expect(entries[0].synthetic).toBe(false)
    expect(entries[1].href).toBe('/campaigns/c1')
    expect(entries[1].tooltip).toContain('Holiday gift guide · Draft · ')
    expect(unscheduled.map((c) => c.id)).toEqual(['K2'])
  })

  it('encodes ids in links', () => {
    const { entries } = plannerEntries({
      campaigns: [],
      snapshot: snapshot([kCampaign({ id: 'a/b?c' })]),
      timezone: tz,
      now
    })
    expect(entries[0].href).toBe('/campaigns/klaviyo/a%2Fb%3Fc?from=planner')
  })

  it('hides entries a newer plan replaced unless asked', () => {
    const replaced = local({ id: 'old', superseded_by_plan: 'p2' })
    const input = { campaigns: [replaced], snapshot: null, timezone: tz, now }
    expect(plannerEntries(input).entries).toEqual([])
    const [entry] = plannerEntries({ ...input, includeReplaced: true }).entries
    expect(entry.status).toBeNull()
    expect(entry.tooltip).toContain('· Replaced ·')
  })

  it('links Klaviyo pages back to the exact planner view', () => {
    const { entries } = plannerEntries({
      campaigns: [],
      snapshot: snapshot([kCampaign({})]),
      timezone: tz,
      now,
      query: query({ m: '2026-11', view: 'table', status: 'sent' })
    })
    expect(entries[0].href).toBe(
      '/campaigns/klaviyo/K1?from=planner&m=2026-11&view=table&status=sent'
    )
  })

  it('names Klaviyo drafts as drafts and labels synthetic demo campaigns', () => {
    const { entries } = plannerEntries({
      campaigns: [local({ synthetic: true })],
      snapshot: snapshot([
        kCampaign({ status: 'draft', sendTime: '2026-11-25T14:00:00Z' })
      ]),
      timezone: tz,
      now
    })
    expect(entries.find((e) => e.source === 'klaviyo')?.tooltip).toContain(
      'Klaviyo sample: Draft for'
    )
    const demo = entries.find((e) => e.source === 'workspace')!
    expect(demo.synthetic).toBe(true)
    expect(demo.tooltip).toContain('· Synthetic demo ·')
  })

  it('skips entries with an unreadable date instead of breaking', () => {
    const { entries } = plannerEntries({
      campaigns: [local({ planned_at: 'not a date' })],
      snapshot: snapshot([kCampaign({ sendTime: 'soon' })]),
      timezone: tz,
      now
    })
    expect(entries).toEqual([])
  })

  it('shows a delivery problem and marks past unsent sends as Missed', () => {
    const { entries } = plannerEntries({
      campaigns: [
        local({ id: 'late', planned_at: '2026-11-02T15:00:00Z' }),
        local({ id: 'bad', delivery_state: 'failed' })
      ],
      snapshot: null,
      timezone: tz,
      now
    })
    expect(entries.find((e) => e.id === 'late')?.status).toBe('missed')
    expect(entries.find((e) => e.id === 'bad')?.status).toBe('delivery_problem')
  })

  it('combines status and channel filters', () => {
    const { entries } = plannerEntries({
      campaigns: [
        local({ id: 'a' }),
        local({ id: 'b', channel: 'email_text' }),
        local({ id: 'c', channel: 'email_text', delivery_state: 'scheduled' })
      ],
      snapshot: null,
      timezone: tz,
      now
    })
    const ids = (q: PlannerQuery) => filterEntries(entries, q).map((e) => e.id)
    expect(ids(query({ status: 'draft' }))).toEqual(['a', 'b'])
    expect(ids(query({ channel: 'email_text' }))).toEqual(['b', 'c'])
    expect(ids(query({ status: 'draft', channel: 'email_text' }))).toEqual([
      'b'
    ])
  })
})

describe('planner month', () => {
  it('starts weeks on Sunday and fills whole weeks', () => {
    const month = plannerMonth({
      month: '2024-02',
      timezone: tz,
      entries: [],
      holidays: [],
      now
    })
    expect(month.label).toBe('February 2024')
    expect(month.days).toHaveLength(35)
    expect(month.days[0]).toMatchObject({ date: '2024-01-28', inMonth: false })
    expect(month.days[4]).toMatchObject({
      date: '2024-02-01',
      day: 1,
      inMonth: true
    })
    expect(month.days.find((d) => d.date === '2024-02-29')?.label).toBe(
      'Thursday, February 29, 2024'
    )
    expect(month.previousMonth).toBe('2024-01')
    expect(month.nextMonth).toBe('2024-03')
    expect(month.isTodayMonth).toBe(false)
    expect(month.todayMonth).toBe('2026-11')
  })

  it('puts entries on their brand-timezone day and marks today and past days', () => {
    const { entries } = plannerEntries({
      // 02:00 UTC on 21 Nov is still 20 Nov in New York.
      campaigns: [local({ planned_at: '2026-11-21T02:00:00Z' })],
      snapshot: null,
      timezone: tz,
      now
    })
    const month = plannerMonth({
      month: '2026-11',
      timezone: tz,
      entries,
      holidays: [{ id: 'h1', name: 'Thanksgiving', date: '2026-11-26' }],
      now
    })
    const day = (date: string) => month.days.find((d) => d.date === date)!
    expect(day('2026-11-20').entries).toHaveLength(1)
    expect(day('2026-11-21').entries).toHaveLength(0)
    expect(day('2026-11-26').holidays.map((h) => h.name)).toEqual([
      'Thanksgiving'
    ])
    expect(day('2026-11-06')).toMatchObject({ today: true, past: false })
    expect(day('2026-11-05')).toMatchObject({ today: false, past: true })
    expect(month.isTodayMonth).toBe(true)
    expect(month.monthEntries).toHaveLength(1)
  })

  it('has 4, 5 or 6 whole weeks as the month needs', () => {
    const cells = (month: string) =>
      plannerMonth({ month, timezone: 'UTC', entries: [], holidays: [], now })
        .days
    // February 2015 starts on a Sunday and has 28 days.
    expect(cells('2015-02')).toHaveLength(28)
    expect(cells('2015-02').every((d) => d.inMonth)).toBe(true)
    // May 2026 starts on a Friday and has 31 days.
    const may = cells('2026-05')
    expect(may).toHaveLength(42)
    expect(may.filter((d) => d.inMonth)).toHaveLength(31)
    expect(may.at(-1)).toMatchObject({ date: '2026-06-06', inMonth: false })
  })

  it('puts month-edge sends on the brand-timezone day without reordering the input', () => {
    const kathmandu = 'Asia/Kathmandu'
    const source = [
      local({ id: 'late', planned_at: '2024-02-01T12:00:00Z' }),
      local({ id: 'before', planned_at: '2024-01-31T18:00:00Z' }),
      local({ id: 'early', planned_at: '2024-01-31T20:00:00Z' }),
      local({ id: 'after', planned_at: '2024-02-29T19:00:00Z' })
    ]
    const { entries } = plannerEntries({
      campaigns: source,
      snapshot: null,
      timezone: kathmandu,
      now
    })
    const month = plannerMonth({
      month: '2024-02',
      timezone: kathmandu,
      entries,
      holidays: [],
      now
    })
    expect(month.monthEntries.map((e) => e.id)).toEqual(['early', 'late'])
    expect(
      month.days.find((d) => d.date === '2024-02-01')!.entries.map((e) => e.id)
    ).toEqual(['early', 'late'])
    // 19:00 UTC on 29 Feb is 1 March in Kathmandu: March's grey cell
    // shows no chip, so the grid agrees with the table and the summary.
    expect(month.days.find((d) => d.date === '2024-03-01')!.entries).toEqual([])
    expect(
      plannerMonth({
        month: '2024-03',
        timezone: kathmandu,
        entries,
        holidays: [],
        now
      }).monthEntries.map((e) => e.id)
    ).toEqual(['after'])
    expect(source.map((c) => c.id)).toEqual([
      'late',
      'before',
      'early',
      'after'
    ])
  })

  it('sums up the month with the same status as the chips', () => {
    const { entries } = plannerEntries({
      campaigns: [
        local({ id: 'a', copy_state: 'pending_approval' }),
        local({ id: 'b', delivery_state: 'failed' }),
        local({ id: 'c', planned_at: '2026-11-02T15:00:00Z' }),
        local({ id: 'd', superseded_by_plan: 'p2' })
      ],
      snapshot: snapshot([kCampaign({})]),
      timezone: tz,
      now,
      includeReplaced: true
    })
    expect(plannerSummary(entries)).toBe(
      '4 campaigns (1 Klaviyo sample) · 1 needs your approval · 1 sent · 1 missed · 1 with a delivery problem'
    )
    expect(plannerSummary([])).toBe('0 campaigns')
    expect(plannerSummary(entries)).not.toMatch(/approved/)
  })

  it('writes four-digit day keys at the edges of time', () => {
    const first = plannerMonth({
      month: '0001-01',
      timezone: 'UTC',
      entries: [],
      holidays: [],
      now
    })
    expect(first.days[0].date).toBe('0000-12-31')
    const last = plannerMonth({
      month: '9999-12',
      timezone: 'UTC',
      entries: [],
      holidays: [],
      now
    })
    expect(last.days.at(-1)!.date).toBe('10000-01-01')
  })

  it('stops at the calendar edges', () => {
    expect(
      plannerMonth({
        month: '9999-12',
        timezone: tz,
        entries: [],
        holidays: [],
        now
      }).nextMonth
    ).toBeNull()
  })
})

describe('Klaviyo entries', () => {
  it('names the source with the label and keeps only drafts in the tray', () => {
    const { entries, unscheduled } = plannerEntries({
      campaigns: [],
      snapshot: {
        campaigns: [
          {
            id: 'K1',
            name: 'Live send',
            status: 'scheduled',
            sendTime: '2026-11-20T15:00:00Z'
          },
          { id: 'K2', name: 'Old idea', status: 'cancelled', sendTime: null },
          { id: 'K3', name: 'Next idea', status: 'draft', sendTime: null },
          { id: 'K4', name: 'Bad time', status: 'draft', sendTime: 'soon' }
        ]
      } as never,
      timezone: 'UTC',
      now: new Date('2026-11-06T12:00:00Z'),
      klaviyoLabel: 'Klaviyo'
    })
    expect(entries[0].tooltip).toMatch(/^Live send · Klaviyo: Scheduled for/)
    expect(unscheduled.map((c) => c.id)).toEqual(['K3', 'K4'])
  })
})
