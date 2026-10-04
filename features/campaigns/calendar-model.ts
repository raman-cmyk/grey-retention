import type { Database } from '@/lib/supabase/database.types'

export type CalendarView = 'calendar' | 'list' | 'history'
export type CalendarCampaign = Pick<
  Database['public']['Tables']['campaigns']['Row'],
  | 'id'
  | 'title'
  | 'planned_at'
  | 'channel'
  | 'calendar_revision'
  | 'calendar_state'
  | 'copy_state'
  | 'delivery_state'
  | 'synthetic'
  | 'superseded_by_plan'
>

export type CalendarDay = {
  date: string
  day: number
  label: string
  inMonth: boolean
  today: boolean
  campaigns: CalendarCampaign[]
}

function utcDay(year: number, month: number, day: number) {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(12, 0, 0, 0)
  return date
}

function dayKey(date: Date) {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export function localCalendarDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value
  return `${value('year').padStart(4, '0')}-${value('month')}-${value('day')}`
}

export function calendarMonth(
  input: string | string[] | undefined,
  timezone: string,
  now = new Date()
) {
  if (
    typeof input === 'string' &&
    /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(input)
  )
    return input
  return localCalendarDate(now, timezone).slice(0, 7)
}

export function calendarView(
  input: string | string[] | undefined
): CalendarView {
  return input === 'list' || input === 'history' ? input : 'calendar'
}

export function adjacentCalendarMonth(month: string, offset: -1 | 1) {
  const [year, number] = month.split('-').map(Number)
  const date = utcDay(year, number + offset, 1)
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null
  return dayKey(date).slice(0, 7)
}

export function buildCampaignCalendar({
  campaigns,
  month,
  timezone,
  view,
  now = new Date()
}: {
  campaigns: CalendarCampaign[]
  month: string
  timezone: string
  view: CalendarView
  now?: Date
}) {
  const today = localCalendarDate(now, timezone)
  const entries = campaigns
    .filter(
      (campaign) =>
        (view === 'history' || !campaign.superseded_by_plan) &&
        localCalendarDate(new Date(campaign.planned_at), timezone).startsWith(
          `${month}-`
        )
    )
    .toSorted(
      (a, b) =>
        new Date(a.planned_at).getTime() - new Date(b.planned_at).getTime() ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id)
    )
  const byDay = new Map<string, CalendarCampaign[]>()
  for (const campaign of entries) {
    const date = localCalendarDate(new Date(campaign.planned_at), timezone)
    const group = byDay.get(date) ?? []
    group.push(campaign)
    byDay.set(date, group)
  }
  const [year, number] = month.split('-').map(Number)
  const first = utcDay(year, number, 1)
  const last = utcDay(year, number + 1, 0)
  // Monday is the first column, including the adjoining days at each edge.
  const leading = (first.getUTCDay() + 6) % 7
  const cellCount = Math.ceil((leading + last.getUTCDate()) / 7) * 7
  const days: CalendarDay[] = Array.from({ length: cellCount }, (_, index) => {
    const date = utcDay(year, number, index + 1 - leading)
    const key = dayKey(date)
    return {
      date: key,
      day: date.getUTCDate(),
      label: new Intl.DateTimeFormat('en', {
        timeZone: 'UTC',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(date),
      inMonth: key.startsWith(`${month}-`),
      today: key === today,
      campaigns: byDay.get(key) ?? []
    }
  })
  return {
    month,
    label: new Intl.DateTimeFormat('en', {
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric'
    }).format(first),
    todayMonth: today.slice(0, 7),
    previousMonth: adjacentCalendarMonth(month, -1),
    nextMonth: adjacentCalendarMonth(month, 1),
    entries,
    days,
    reviewCount: entries.filter(
      (campaign) =>
        !campaign.superseded_by_plan && campaign.calendar_state === 'proposed'
    ).length,
    approvedCount: entries.filter(
      (campaign) =>
        !campaign.superseded_by_plan && campaign.calendar_state === 'approved'
    ).length,
    scheduledCount: entries.filter(
      (campaign) =>
        !campaign.superseded_by_plan && campaign.delivery_state === 'scheduled'
    ).length
  }
}
