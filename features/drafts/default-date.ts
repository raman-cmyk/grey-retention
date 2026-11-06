import { localCalendarDate } from '@/features/campaigns/calendar-model'
import { validTimezone } from '@/lib/brand-time'
import { localDateTime } from '@/lib/local-time'

const hour = 3_600_000

/**
 * The send time the first-draft form starts with, in the brand timezone.
 * A day picked on the Campaigns calendar ("+ plan send", `?date=`) wins
 * when it is a real day, today or later: 10:00 that day, or for today the
 * next whole hour at least an hour away (10:00 tomorrow when today is
 * nearly over). Anything else: one week from now.
 */
export function draftDefaultDate(
  day: unknown,
  timezone: string,
  now = new Date()
) {
  const tz = validTimezone(timezone)
  const fallback = localDateTime(new Date(now.getTime() + 168 * hour), tz)
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))
    return fallback
  const [y, m, d] = day.split('-').map(Number)
  const check = new Date(Date.UTC(y, m - 1, d))
  if (
    y < 1000 ||
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  )
    return fallback
  const today = localCalendarDate(now, tz)
  if (day > today) return `${day}T10:00`
  if (day < today) return fallback
  const soon = localDateTime(new Date(now.getTime() + 2 * hour), tz)
  if (soon.startsWith(`${day}T`)) return `${soon.slice(0, 13)}:00`
  // Too late today: the next morning, not a week away. Count the calendar
  // day, not 24 hours (a daylight-saving night is 23 hours long).
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return `${next.toISOString().slice(0, 10)}T10:00`
}
