import { cleanup, render, screen, within } from '@testing-library/react'
import type { Route } from 'next'
import { afterEach, describe, expect, it } from 'vitest'
import type { KlaviyoCampaign } from '@/lib/providers/klaviyo-read'
import {
  plannerEntries,
  plannerMonth,
  plannerSummary,
  statusCounts,
  undatedShown,
  type PlannerEntry,
  type PlannerQuery
} from './model'
import { Planner } from './planner'

const now = new Date('2026-11-06T17:00:00Z')
const tz = 'America/New_York'
const base: PlannerQuery = {
  m: '2026-11',
  view: 'calendar',
  status: 'all',
  channel: 'all',
  history: false
}
const entry = (over: Partial<PlannerEntry>): PlannerEntry => ({
  key: 'w-c1',
  id: 'c1',
  name: 'Holiday gift guide',
  at: '2026-11-20T15:00:00Z',
  channel: 'email_design',
  status: 'needs_approval',
  source: 'workspace',
  synthetic: false,
  updated: null,
  href: '/campaigns/c1' as Route,
  tooltip:
    'Holiday gift guide · Needs your approval · Nov 20, 10:00 AM (New York time)',
  ...over
})
const newItems = [
  {
    label: 'Single send',
    hint: 'One email.',
    href: '#create-campaign' as Route
  }
]

function show({
  query = base,
  entries = [entry({})],
  canPlan = true,
  items = newItems,
  unscheduled = [] as KlaviyoCampaign[],
  campaignsFailed = false,
  counts = {} as Partial<Record<string, number>>
} = {}) {
  const month = plannerMonth({
    month: query.m,
    timezone: tz,
    entries,
    holidays: [{ id: 'h1', name: 'Thanksgiving', date: '2026-11-26' }],
    now
  })
  return render(
    <Planner
      query={query}
      month={month}
      unscheduled={unscheduled}
      timezone={tz}
      klaviyoLine="Klaviyo sends here are sample data, not from a real account."
      klaviyoLabel="Klaviyo sample"
      summary={plannerSummary(month.monthEntries)}
      counts={counts}
      now={now}
      canPlan={canPlan}
      campaignsFailed={campaignsFailed}
      newItems={items}
    />
  )
}

afterEach(cleanup)

describe('Campaigns planner', () => {
  it('shows the month as a Sunday-first calendar with chips and holidays', () => {
    show()
    expect(
      screen.getByRole('heading', { name: 'November 2026', level: 2 })
    ).toBeVisible()
    const grid = screen.getByRole('table', {
      name: 'November 2026 campaign calendar'
    })
    const headers = within(grid).getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent)).toEqual([
      'SunSunday',
      'MonMonday',
      'TueTuesday',
      'WedWednesday',
      'ThuThursday',
      'FriFriday',
      'SatSaturday'
    ])
    const chip = within(grid).getByRole('link', { name: /Holiday gift guide/ })
    expect(chip).toHaveAttribute('href', '/campaigns/c1')
    expect(chip).toHaveAttribute(
      'title',
      expect.stringContaining('(New York time)')
    )
    // The send time is in the name, not only in the hover title.
    expect(chip).toHaveAccessibleName(
      'Holiday gift guide · Needs your approval · 10:00 AM'
    )
    // The status is visible in words, not only as a colour.
    expect(within(chip).getByText('Needs your approval')).toBeVisible()
    expect(within(grid).getByText('Thanksgiving')).toBeVisible()
    expect(grid.querySelector('time[aria-current="date"]')).toHaveAttribute(
      'datetime',
      '2026-11-06'
    )
    expect(screen.getByText('Times: New York time')).toBeVisible()
    // Holidays and events have their own page (UIR-012).
    expect(
      screen.getByRole('link', { name: 'Holidays & Events' })
    ).toHaveAttribute('href', '/holidays')
    expect(screen.getByText('1 campaign · 1 needs your approval')).toBeVisible()
    // Sample data is labelled.
    expect(
      screen.getByText(/sample data, not from a real account/)
    ).toBeVisible()
  })

  it('offers "+ plan send" only on today and later days in this month, for owners', () => {
    show()
    const grid = screen.getByRole('table', {
      name: 'November 2026 campaign calendar'
    })
    const plan = within(grid).getAllByRole('link', { name: /^\+ plan send/ })
    expect(plan[0]).toHaveAccessibleName(
      '+ plan send on Friday, November 6, 2026'
    )
    expect(plan[0]).toHaveAttribute(
      'href',
      '/first-draft?date=2026-11-06&from=planner&m=2026-11'
    )
    expect(plan).toHaveLength(25) // 6–30 November
    cleanup()
    show({ canPlan: false })
    expect(screen.queryAllByRole('link', { name: /plan send/ })).toHaveLength(0)
  })

  it('keeps filters in links, marks the current ones, and offers Reset', () => {
    show({
      query: { ...base, status: 'scheduled', channel: 'email_text' },
      entries: []
    })
    const status = screen.getByRole('navigation', { name: 'Filter by status' })
    expect(
      within(status).getByRole('link', { name: /^Scheduled \(/ })
    ).toHaveAttribute('aria-current', 'true')
    expect(
      within(status).getByRole('link', { name: /^Draft \(/ })
    ).toHaveAttribute(
      'href',
      '/campaign-agent?m=2026-11&status=draft&channel=email_text'
    )
    expect(screen.getByRole('link', { name: 'Reset' })).toHaveAttribute(
      'href',
      '/campaign-agent?m=2026-11'
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'No campaigns match these filters this month.'
    )
    expect(screen.getByRole('link', { name: 'Next month' })).toHaveAttribute(
      'href',
      '/campaign-agent?m=2026-12&status=scheduled&channel=email_text'
    )
  })

  it('shows Today only away from the current month', () => {
    show()
    expect(screen.queryByRole('link', { name: 'Today' })).toBeNull()
    cleanup()
    show({ query: { ...base, m: '2024-02' }, entries: [] })
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute(
      'href',
      '/campaign-agent?m=2026-11'
    )
    expect(
      screen
        .getByRole('table', { name: 'February 2024 campaign calendar' })
        .querySelectorAll('tbody tr')
    ).toHaveLength(5)
  })

  it('switches to a table with times, channel, status and source', () => {
    const { entries } = plannerEntries({
      campaigns: [],
      snapshot: {
        campaigns: [
          {
            id: 'K1',
            name: 'Black Friday early access',
            status: 'sent',
            sendTime: '2026-11-03T14:00:00Z'
          }
        ]
      } as never,
      timezone: tz,
      now
    })
    show({
      query: { ...base, view: 'table' },
      entries: [
        ...entries,
        entry({}),
        entry({ key: 'w-s', id: 's', name: 'Demo send', synthetic: true })
      ]
    })
    expect(screen.getByRole('link', { name: 'Table' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    const table = screen.getByRole('table', { name: 'Campaigns this month' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Black Friday early access')
    expect(rows[0]).toHaveTextContent('Klaviyo sample')
    expect(rows[1]).toHaveTextContent('This workspace')
    expect(rows[2]).toHaveTextContent('This workspace · synthetic demo')
    expect(within(table).getByText(/When · New York time/)).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Show replaced entries' })
    ).toHaveAttribute('href', '/campaign-agent?m=2026-11&view=table&history=1')
  })

  it('offers the replaced-entries switch in the calendar view too', () => {
    show({ query: { ...base, history: true } })
    expect(
      screen.getByRole('link', { name: 'Hide replaced entries' })
    ).toHaveAttribute('href', '/campaign-agent?m=2026-11')
  })

  it('shows every status in the legend, Cancelled and Delivery problem included', () => {
    show()
    const legend = screen.getByText('Legend:').parentElement!
    for (const word of [
      'Draft',
      'With designer',
      'Needs your approval',
      'Scheduled',
      'Sent',
      'Cancelled',
      'Missed',
      'Delivery problem'
    ])
      expect(within(legend).getByText(word)).toBeVisible()
    const status = screen.getByRole('navigation', { name: 'Filter by status' })
    expect(
      within(status).getByRole('link', { name: /^Cancelled \(/ })
    ).toBeVisible()
    expect(
      within(status).getByRole('link', { name: /^Delivery problem \(/ })
    ).toBeVisible()
  })

  it('marks Klaviyo sample and synthetic chips in words', () => {
    show({
      entries: [
        entry({
          key: 'k-1',
          id: 'K1',
          name: 'Sample send',
          source: 'klaviyo',
          status: 'sent',
          href: '/campaigns/klaviyo/K1?from=planner' as Route
        }),
        entry({ key: 'w-d', id: 'd', name: 'Demo plan', synthetic: true })
      ]
    })
    const grid = screen.getByRole('table', {
      name: 'November 2026 campaign calendar'
    })
    expect(
      within(grid).getByRole('link', { name: /Sample send/ })
    ).toHaveTextContent('Sent · Klaviyo sample')
    expect(
      within(grid).getByRole('link', { name: /Demo plan/ })
    ).toHaveTextContent('Needs your approval · Synthetic demo')
  })

  it('says the month is empty on small screens', () => {
    // No campaigns and no holidays: the agenda says so.
    const month = plannerMonth({
      month: '2026-12',
      timezone: tz,
      entries: [],
      holidays: [],
      now
    })
    render(
      <Planner
        query={{ ...base, m: '2026-12' }}
        month={month}
        unscheduled={[]}
        timezone={tz}
        klaviyoLine=""
        klaviyoLabel="Klaviyo sample"
        summary="0 campaigns"
        counts={{}}
        canPlan
        newItems={[]}
      />
    )
    expect(
      screen.getByText('No campaigns, holidays or events this month.')
    ).toBeInTheDocument()
  })

  it('shows how many campaigns each status pill holds', () => {
    show({ counts: { all: 3, draft: 2, sent: 1 } })
    const status = screen.getByRole('navigation', { name: 'Filter by status' })
    expect(
      within(status).getByRole('link', { name: 'All statuses (3)' })
    ).toBeVisible()
    expect(
      within(status).getByRole('link', { name: 'Draft (2)' })
    ).toBeVisible()
    expect(
      within(status).getByRole('link', { name: 'Missed (0)' })
    ).toBeVisible()
  })

  it('lists Klaviyo drafts with no send time in the table, with update times', () => {
    show({
      query: { ...base, view: 'table' },
      entries: [entry({ updated: '2026-11-05T12:00:00Z' })],
      unscheduled: [
        {
          id: 'K9',
          name: 'Cold brew season',
          updated: '2026-10-30T12:00:00Z'
        } as KlaviyoCampaign
      ]
    })
    const table = screen.getByRole('table', { name: 'Campaigns this month' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('1 day ago')
    expect(rows[1]).toHaveTextContent('No send time')
    expect(rows[1]).toHaveTextContent('Cold brew season')
    expect(rows[1]).toHaveTextContent('Klaviyo sample')
    expect(rows[1]).toHaveTextContent('1 week ago')
    expect(
      within(rows[1]).getByRole('link', { name: 'Cold brew season' })
    ).toHaveAttribute(
      'href',
      '/campaigns/klaviyo/K9?from=planner&m=2026-11&view=table'
    )
    // In the table they are rows, so the separate tray is not repeated.
    expect(
      screen.queryByRole('region', { name: 'Not scheduled in Klaviyo' })
    ).toBeNull()
  })

  it('says so when the table has nothing this month, once', () => {
    show({ query: { ...base, view: 'table' }, entries: [] })
    expect(screen.getByText(/No campaigns this month\./)).toBeVisible()
    cleanup()
    show({ query: { ...base, view: 'table', status: 'sent' }, entries: [] })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Nothing was sent this month.'
    )
    expect(screen.queryByText(/No campaigns this month\./)).toBeNull()
  })

  it('hides + New when nothing can be created, and lists unscheduled Klaviyo drafts', () => {
    show({
      items: [],
      unscheduled: [{ id: 'K 2', name: 'Draft idea' } as KlaviyoCampaign]
    })
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull()
    const tray = screen.getByRole('region', {
      name: 'Not scheduled in Klaviyo'
    })
    expect(
      within(tray).getByRole('link', { name: /Draft idea/ })
    ).toHaveAttribute('href', '/campaigns/klaviyo/K%202?from=planner&m=2026-11')
    cleanup()
  })

  it('agrees with itself: an undated Klaviyo draft is counted, listed, and not "nothing"', () => {
    const undated = [
      {
        id: 'K9',
        name: 'Cold brew season',
        updated: null
      } as unknown as KlaviyoCampaign
    ]
    const query = { ...base, view: 'table' as const, status: 'draft' as const }
    show({
      query,
      entries: [],
      unscheduled: undatedShown(undated, query),
      counts: statusCounts(
        [],
        undatedShown(undated, { status: 'all', channel: 'all' }).length
      )
    })
    const status = screen.getByRole('navigation', { name: 'Filter by status' })
    expect(
      within(status).getByRole('link', { name: 'Draft (1)' })
    ).toBeVisible()
    expect(
      within(status).getByRole('link', { name: 'All statuses (1)' })
    ).toBeVisible()
    expect(screen.queryByRole('status')).toBeNull()
    const rows = within(
      screen.getByRole('table', { name: 'Campaigns this month' })
    )
      .getAllByRole('row')
      .slice(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Cold brew season')
  })

  it('says each empty status in its own plain sentence', () => {
    show({ query: { ...base, status: 'needs_approval' }, entries: [] })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Nothing needs your approval this month.'
    )
  })

  it('shows the exact update time and timezone on hover', () => {
    show({
      query: { ...base, view: 'table' },
      entries: [entry({ updated: '2026-11-05T12:00:00Z' })]
    })
    const time = screen.getByText('1 day ago')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('dateTime', '2026-11-05T12:00:00Z')
    expect(time).toHaveAttribute(
      'title',
      expect.stringContaining('(New York time)')
    )
  })

  it('shows a delivery problem and a replaced entry in words, not colour only', () => {
    show({
      entries: [
        entry({ status: 'delivery_problem' }),
        entry({ key: 'w-old', id: 'old', name: 'Old plan', status: null })
      ]
    })
    const grid = screen.getByRole('table', {
      name: 'November 2026 campaign calendar'
    })
    const problem = within(grid).getByRole('link', {
      name: /Holiday gift guide/
    })
    expect(problem).toHaveAccessibleName(
      'Holiday gift guide · Delivery problem · 10:00 AM'
    )
    expect(within(problem).getByText('Delivery problem')).toBeVisible()
    const old = within(grid).getByRole('link', { name: /Old plan/ })
    expect(old).toHaveAccessibleName('Old plan · Replaced · 10:00 AM')
    expect(within(old).getByText('Replaced')).toBeVisible()
  })

  it('keeps "+ plan send" below the chips, never on top of them', () => {
    show({
      entries: [
        entry({ key: 'a', id: 'a', name: 'One', at: '2026-11-20T15:00:00Z' }),
        entry({ key: 'b', id: 'b', name: 'Two', at: '2026-11-20T16:00:00Z' }),
        entry({ key: 'c', id: 'c', name: 'Three', at: '2026-11-20T17:00:00Z' })
      ]
    })
    const grid = screen.getByRole('table', {
      name: 'November 2026 campaign calendar'
    })
    const plan = within(grid).getByRole('link', {
      name: '+ plan send on Friday, November 20, 2026'
    })
    expect(plan.className).not.toMatch(/absolute/)
    const cell = plan.closest('td')!
    const links = within(cell).getAllByRole('link')
    expect(links.at(-1)).toBe(plan)
  })
  it('lets owners plan a listed future day from the phone agenda', () => {
    show({
      entries: [
        entry({
          key: 'p',
          id: 'p',
          name: 'Past send',
          at: '2026-11-02T15:00:00Z',
          status: 'sent'
        }),
        entry({})
      ]
    })
    const agenda = screen.getByRole('region', { name: 'Campaign agenda' })
    const plan = within(agenda).getAllByRole('link', { name: /plan send/ })
    // Future listed days only (a send, a holiday); the past day lists its
    // send but no plan link.
    expect(plan.map((l) => l.textContent)).toEqual([
      '+ plan send on Friday, November 20, 2026',
      '+ plan send on Thursday, November 26, 2026'
    ])
    expect(plan[0]).toHaveAttribute(
      'href',
      '/first-draft?date=2026-11-20&from=planner&m=2026-11'
    )
    cleanup()
    show({ canPlan: false })
    expect(
      within(
        screen.getByRole('region', { name: 'Campaign agenda' })
      ).queryAllByRole('link', { name: /plan send/ })
    ).toHaveLength(0)
  })

  it('does not call the month empty when campaigns failed to load', () => {
    show({ entries: [], campaignsFailed: true })
    expect(
      screen.queryByText('No campaigns, holidays or events this month.')
    ).toBeNull()
    cleanup()
    show({
      entries: [],
      campaignsFailed: true,
      query: { ...base, view: 'table' }
    })
    expect(screen.queryByText(/No campaigns this month/)).toBeNull()
  })
  it('labels the tray as sample data and promises nothing a sample cannot do', () => {
    show({
      unscheduled: [
        { id: 'K3', name: 'Next idea', status: 'draft', sendTime: null }
      ] as KlaviyoCampaign[]
    })
    const tray = screen.getByRole('region', {
      name: 'Not scheduled in Klaviyo'
    })
    expect(within(tray).getByText('· Klaviyo sample')).toBeVisible()
    expect(
      within(tray).getByText(/^Klaviyo sample drafts with no send time/)
    ).toBeVisible()
    // The dashed-outline legend is for calendar chips, which are none here.
    expect(screen.queryByText(/Dashed outline/)).toBeNull()
  })
})
