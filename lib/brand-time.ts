/**
 * Owner-facing dates and times in the ONE brand timezone
 * (docs/OWNER_JOURNEYS.md §18.14), in the spec's format
 * `Oct 7, 2026 · 10:49 PM` (docs/UI_REBUILD_SPEC.md §2).
 */

function toDate(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function validZone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/** `Oct 7, 2026 · 10:49 PM`, or null for a missing or invalid date. */
export function formatBrandDateTime(
  value: Date | string | number | null | undefined,
  timezone: string
) {
  const date = toDate(value)
  if (!date) return null
  const zone = validZone(timezone) ? timezone : 'UTC'
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date)
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date)
  return `${day} · ${time}`
}

/** `Oct 7, 2026` (date only), or null for a missing or invalid date. */
export function formatBrandDate(
  value: Date | string | number | null | undefined,
  timezone: string
) {
  const date = toDate(value)
  if (!date) return null
  return new Intl.DateTimeFormat('en-US', {
    timeZone: validZone(timezone) ? timezone : 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date)
}

/** "Sydney time" for `Australia/Sydney`; "UTC" for UTC or an invalid zone. */
export function timezoneLabel(timezone: string) {
  if (!validZone(timezone) || /^(etc\/)?(utc|gmt)$/i.test(timezone))
    return 'UTC'
  // Etc/GMT+5 means UTC−5 (POSIX sign), so name it by its real offset.
  if (/^etc\//i.test(timezone))
    return (
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'shortOffset'
      })
        .formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')
        ?.value.replace('GMT', 'UTC') ?? 'UTC'
    )
  const city = timezone.split('/').at(-1)!.replaceAll('_', ' ')
  return `${city} time`
}

const day = 24 * 3600
// [unit, size in seconds, shown from]: months only from 5 weeks, so a month
// ago still reads "4 weeks ago" like the old app.
const units: [Intl.RelativeTimeFormatUnit, number, number][] = [
  ['year', 365 * day, 365 * day],
  ['month', 30 * day, 35 * day],
  ['week', 7 * day, 7 * day],
  ['day', day, day],
  ['hour', 3600, 3600],
  ['minute', 60, 60]
]

/** "4 weeks ago", "in 3 days", "just now"; null for an invalid date. */
export function relativeTime(
  value: Date | string | number | null | undefined,
  now: Date = new Date()
) {
  const date = toDate(value)
  if (!date) return null
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000)
  if (Math.abs(seconds) < 60) return 'just now'
  const format = new Intl.RelativeTimeFormat('en-US', { numeric: 'always' })
  for (const [unit, size, from] of units)
    if (Math.abs(seconds) >= from) {
      const amount = Math.trunc(seconds / size)
      // 360–364 days is still "11 months", never "12 months".
      return unit === 'month'
        ? format.format(
            Math.sign(amount) * Math.min(11, Math.abs(amount)),
            unit
          )
        : format.format(amount, unit)
    }
  return 'just now'
}
