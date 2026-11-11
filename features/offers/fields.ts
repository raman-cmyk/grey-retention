/** Form fields for offers, checked the same way the database checks them. */

export function parseCode(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim()
  return /^[A-Za-z0-9_-]{3,40}$/.test(code) ? code : null
}

export function parsePercent(
  value: FormDataEntryValue | null,
  min: 0 | 1
): number | null {
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value.trim())) return null
  const n = Number(value.trim())
  return n >= min && n <= 100 ? n : null
}

/** Minutes the timezone is ahead of UTC at that instant. */
function offsetMinutes(timezone: string, at: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value])
  )
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  )
  return Math.round((local - Math.floor(at / 1000) * 1000) / 60_000)
}

/**
 * A date from `<input type="date">` (yyyy-mm-dd): the code works until the
 * end of that day in the brand's timezone. Empty means it doesn't expire
 * (null); anything else is invalid (undefined).
 */
export function parseExpiry(
  value: FormDataEntryValue | null,
  timezone = 'UTC'
): string | null | undefined {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return undefined
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const wall = Date.UTC(y, m - 1, d, 23, 59, 59)
  if (new Date(wall).toISOString().slice(0, 10) !== value) return undefined
  try {
    // Twice, so a day that changes clocks still lands on that day's end.
    let at = wall - offsetMinutes(timezone, wall) * 60_000
    at = wall - offsetMinutes(timezone, at) * 60_000
    return new Date(at).toISOString()
  } catch {
    return undefined
  }
}
