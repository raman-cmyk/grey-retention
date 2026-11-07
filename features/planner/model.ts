import type { Route } from 'next'
import {
  adjacentCalendarMonth,
  calendarMonth,
  localCalendarDate,
  type CalendarCampaign
} from '@/features/campaigns/calendar-model'
import { campaignStatusOf } from '@/features/campaigns/status'
import {
  formatBrandDateTime,
  timezoneLabel,
  validTimezone
} from '@/lib/brand-time'
import {
  campaignStatuses,
  isCampaignStatus,
  type CampaignStatus
} from '@/lib/campaign-status'
import type {
  KlaviyoCampaign,
  KlaviyoSnapshot
} from '@/lib/providers/klaviyo-read'

export type PlannerView = 'calendar' | 'table'
export type ChannelFilter = 'all' | 'email_design' | 'email_text'

/** The planner's URL state (OWNER_JOURNEYS.md §6: filters live in the URL). */
export type PlannerQuery = {
  m: string
  view: PlannerView
  status: 'all' | CampaignStatus
  channel: ChannelFilter
  /** Also show entries a newer plan replaced. */
  history: boolean
}

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

export function readPlannerQuery(
  raw: Record<string, string | string[] | undefined>,
  timezone: string,
  now = new Date()
): PlannerQuery {
  const view = one(raw.view)
  const status = one(raw.status)
  const channel = one(raw.channel)
  return {
    // A zone Postgres accepts but this runtime does not falls back to UTC.
    m: calendarMonth(one(raw.m), validTimezone(timezone), now),
    // The old `list` and `history` views open the table.
    view:
      view === 'table' || view === 'list' || view === 'history'
        ? 'table'
        : 'calendar',
    status: isCampaignStatus(status) ? status : 'all',
    channel:
      channel === 'email_design' || channel === 'email_text' ? channel : 'all',
    history: one(raw.history) === '1' || view === 'history'
  }
}

/** `/campaign-agent?…` with `patch` applied; every other filter is kept. */
export function plannerHref(
  query: PlannerQuery,
  patch: Partial<PlannerQuery>
): Route {
  const next = { ...query, ...patch }
  const params = new URLSearchParams({ m: next.m })
  if (next.view !== 'calendar') params.set('view', next.view)
  if (next.status !== 'all') params.set('status', next.status)
  if (next.channel !== 'all') params.set('channel', next.channel)
  if (next.history) params.set('history', '1')
  return `/campaign-agent?${params}` as Route
}

export const filtersActive = (q: PlannerQuery) =>
  q.status !== 'all' || q.channel !== 'all'

export type PlannerEntry = {
  key: string
  id: string
  name: string
  at: string
  channel: 'email_design' | 'email_text'
  /** null for an entry a newer plan replaced. */
  status: CampaignStatus | null
  source: 'workspace' | 'klaviyo'
  /** A made-up campaign from the planning fixtures ("Synthetic demo"). */
  synthetic: boolean
  href: Route
  /** Hover text with the real time and timezone (OWNER_JOURNEYS §6 fix). */
  tooltip: string
}

const klaviyoStatus: Record<KlaviyoCampaign['status'], CampaignStatus> = {
  sent: 'sent',
  scheduled: 'scheduled',
  cancelled: 'cancelled',
  draft: 'draft'
}

/**
 * A Klaviyo campaign's detail page, with a Back link to this exact planner
 * view (`from=planner` plus the planner's own URL state).
 */
export function klaviyoCampaignHref(id: string, query?: PlannerQuery): Route {
  const back = query ? `&${plannerHref(query, {}).split('?')[1]}` : ''
  return `/campaigns/klaviyo/${encodeURIComponent(id)}?from=planner${back}` as Route
}

const validDate = (at: string | null | undefined): at is string =>
  typeof at === 'string' && Number.isFinite(Date.parse(at))

const klaviyoVerb: Record<KlaviyoCampaign['status'], string> = {
  sent: 'Sent',
  scheduled: 'Scheduled for',
  cancelled: 'Cancelled',
  draft: 'Draft for'
}

/**
 * Every campaign the planner shows: this workspace's own campaigns AND the
 * Klaviyo sends (sample data in fake mode), so the calendar and the table
 * always agree (§15 bug 3). Klaviyo drafts with no (readable) send time
 * are returned separately for the "Not scheduled" tray. Entries with an unreadable date
 * are left out rather than breaking the page.
 */
export function plannerEntries({
  campaigns,
  snapshot,
  timezone,
  now = new Date(),
  includeReplaced = false,
  query,
  klaviyoLabel = 'Klaviyo sample'
}: {
  campaigns: readonly (CalendarCampaign & { design_state: string })[]
  snapshot: KlaviyoSnapshot | null
  timezone: string
  now?: Date
  includeReplaced?: boolean
  /** The planner view, so Klaviyo pages can link back to it. */
  query?: PlannerQuery
  /** "Klaviyo sample" while the data is sample, "Klaviyo" when live. */
  klaviyoLabel?: string
}) {
  const tz = validTimezone(timezone)
  const when = (at: string) =>
    `${formatBrandDateTime(at, tz)} (${timezoneLabel(tz)})`
  const local: PlannerEntry[] = campaigns
    .filter(
      (c) =>
        (includeReplaced || !c.superseded_by_plan) && validDate(c.planned_at)
    )
    .map((c) => {
      const status = campaignStatusOf(c, now)
      return {
        key: `w-${c.id}`,
        id: c.id,
        name: c.title,
        at: c.planned_at,
        channel: c.channel === 'email_text' ? 'email_text' : 'email_design',
        status,
        source: 'workspace',
        synthetic: c.synthetic,
        href: `/campaigns/${encodeURIComponent(c.id)}` as Route,
        tooltip: `${c.title} · ${status ? campaignStatuses[status].label : 'Replaced'}${c.synthetic ? ' · Synthetic demo' : ''} · ${when(c.planned_at)}`
      }
    })
  const klaviyo: PlannerEntry[] = (snapshot?.campaigns ?? [])
    .filter((c) => validDate(c.sendTime))
    .map((c) => ({
      key: `k-${c.id}`,
      id: c.id,
      name: c.name,
      at: c.sendTime!,
      channel: 'email_design',
      status: klaviyoStatus[c.status],
      source: 'klaviyo',
      synthetic: false,
      href: klaviyoCampaignHref(c.id, query),
      tooltip: `${c.name} · ${klaviyoLabel}: ${klaviyoVerb[c.status]} ${when(c.sendTime!)}`
    }))
  // Only drafts belong in the "Not scheduled" tray; a cancelled or sent
  // campaign without a readable time is not something to schedule.
  const unscheduled = (snapshot?.campaigns ?? []).filter(
    (c) => c.status === 'draft' && !validDate(c.sendTime)
  )
  return {
    entries: [...local, ...klaviyo].sort(
      (a, b) =>
        Date.parse(a.at) - Date.parse(b.at) ||
        a.name.localeCompare(b.name) ||
        a.key.localeCompare(b.key)
    ),
    unscheduled
  }
}

/**
 * "4 campaigns (1 Klaviyo sample) · 1 needs your approval · 1 scheduled",
 * counted with the same status as the chips (UIR-015). Give it the whole
 * month, not the filtered view. Replaced entries are not counted.
 */
export function plannerSummary(
  entries: readonly PlannerEntry[],
  klaviyoLabel = 'Klaviyo sample'
) {
  const current = entries.filter((e) => e.status)
  const count = (status: CampaignStatus) =>
    current.filter((e) => e.status === status).length
  const fromKlaviyo = current.filter((e) => e.source === 'klaviyo').length
  const parts = [
    `${current.length} ${current.length === 1 ? 'campaign' : 'campaigns'}${fromKlaviyo ? ` (${fromKlaviyo} ${klaviyoLabel})` : ''}`
  ]
  const approvals = count('needs_approval')
  if (approvals)
    parts.push(
      `${approvals} ${approvals === 1 ? 'needs' : 'need'} your approval`
    )
  for (const [status, word] of [
    ['scheduled', 'scheduled'],
    ['sent', 'sent'],
    ['missed', 'missed'],
    ['delivery_problem', 'with a delivery problem']
  ] as const) {
    const n = count(status)
    if (n) parts.push(`${n} ${word}`)
  }
  return parts.join(' · ')
}

/** Status and channel filters combine (AND). Replaced entries match "All". */
export function filterEntries(entries: PlannerEntry[], query: PlannerQuery) {
  return entries.filter(
    (e) =>
      (query.status === 'all' || e.status === query.status) &&
      (query.channel === 'all' || e.channel === query.channel)
  )
}

export type PlannerHoliday = { id: string; name: string; date: string }

export type PlannerDay = {
  date: string
  day: number
  label: string
  inMonth: boolean
  today: boolean
  past: boolean
  entries: PlannerEntry[]
  holidays: PlannerHoliday[]
}

function utcDay(year: number, month: number, day: number) {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(12, 0, 0, 0)
  return date
}

const key = (date: Date) =>
  `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`

/** The month as Sunday-first weeks (spec §6), in the brand timezone. */
export function plannerMonth({
  month,
  timezone,
  entries,
  holidays,
  now = new Date()
}: {
  month: string
  timezone: string
  entries: PlannerEntry[]
  holidays: PlannerHoliday[]
  now?: Date
}) {
  const tz = validTimezone(timezone)
  const today = localCalendarDate(now, tz)
  const byDay = new Map<string, PlannerEntry[]>()
  for (const entry of entries) {
    const date = localCalendarDate(new Date(entry.at), tz)
    byDay.set(date, [...(byDay.get(date) ?? []), entry])
  }
  const holidaysByDay = new Map<string, PlannerHoliday[]>()
  for (const holiday of holidays)
    holidaysByDay.set(holiday.date, [
      ...(holidaysByDay.get(holiday.date) ?? []),
      holiday
    ])
  const [year, number] = month.split('-').map(Number)
  const first = utcDay(year, number, 1)
  const last = utcDay(year, number + 1, 0)
  const leading = first.getUTCDay()
  const cells = Math.ceil((leading + last.getUTCDate()) / 7) * 7
  const days: PlannerDay[] = Array.from({ length: cells }, (_, index) => {
    const date = utcDay(year, number, index + 1 - leading)
    const k = key(date)
    return {
      date: k,
      day: date.getUTCDate(),
      label: new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(date),
      inMonth: k.startsWith(`${month}-`),
      today: k === today,
      past: k < today,
      // The grey days of the next and previous months show no chips, so the
      // grid, the table, the summary and the empty notice all agree.
      entries: k.startsWith(`${month}-`) ? (byDay.get(k) ?? []) : [],
      holidays: holidaysByDay.get(k) ?? []
    }
  })
  return {
    month,
    label: new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric'
    }).format(first),
    isTodayMonth: today.slice(0, 7) === month,
    todayMonth: today.slice(0, 7),
    previousMonth: adjacentCalendarMonth(month, -1),
    nextMonth: adjacentCalendarMonth(month, 1),
    days,
    monthEntries: days.filter((d) => d.inMonth).flatMap((d) => d.entries)
  }
}
