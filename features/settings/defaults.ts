import { validTimezone } from '@/lib/brand-time'

/** "Fri, Nov 6 2026 · 9:07 AM" in the given timezone (UTC if unknown). */
export function localTime(timezone: string, at: Date) {
  const zone = validTimezone(timezone)
  const get = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options }).format(at)
  return `${get({ weekday: 'short' })}, ${get({ month: 'short' })} ${get({ day: 'numeric' })} ${get({ year: 'numeric' })} · ${get({ hour: 'numeric', minute: '2-digit' })}`
}
