import type { Database } from '@/lib/supabase/database.types'

export type CalendarCampaign = Pick<
  Database['public']['Tables']['campaigns']['Row'],
  | 'id'
  | 'title'
  | 'planned_at'
  | 'channel'
  | 'calendar_revision'
  | 'calendar_state'
  | 'copy_state'
  | 'design_state'
  | 'delivery_state'
  | 'synthetic'
  | 'superseded_by_plan'
>

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

export function adjacentCalendarMonth(month: string, offset: -1 | 1) {
  const [year, number] = month.split('-').map(Number)
  const date = utcDay(year, number + offset, 1)
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null
  return dayKey(date).slice(0, 7)
}
