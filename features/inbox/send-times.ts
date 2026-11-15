import { factsSchema, summaryWindowDays } from './brand-summary'

/**
 * CMP-048 (owner pick #48, D27): when and how often a competitor sends,
 * from its emails' stored facts (INB-003), in the reader's timezone. The
 * brand summary keeps one "usual" day and hour; this is the whole map the
 * Competitors screen and the planner can read.
 */
export const weekdays = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun'
] as const
export type Weekday = (typeof weekdays)[number]

/** Quiet days are only claimed from at least this many emails. */
export const quietDaysFrom = 14

export type SendTimeMap = {
  emails: number
  /** Emails a week since the first week with an email (at least one week). */
  perWeek: number
  /** Each week from the first one with an email to this week, Monday first (0 when none). */
  byWeek: { weekStart: string; emails: number }[]
  /** Emails by day (Monday first) and local hour (0 to 23). */
  grid: number[][]
  byDay: { day: Weekday; emails: number }[]
  /** Up to three day-and-hour slots seen at least twice, most first. */
  usual: { day: Weekday; hour: number; emails: number }[]
  /** Days it never sends, from at least `quietDaysFrom` emails; else empty. */
  quietDays: Weekday[]
}

const dayMs = 86_400_000
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * dayMs)
    .toISOString()
    .slice(0, 10)

/**
 * The map from a brand's stored facts in the last `windowDays` days, or
 * null when none can be read (or the timezone is not real).
 */
export function sendTimeMap(
  rows: readonly { facts: unknown }[],
  {
    now,
    timezone,
    windowDays = summaryWindowDays
  }: { now: number; timezone: string; windowDays?: number }
): SendTimeMap | null {
  let local: Intl.DateTimeFormat
  try {
    local = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23'
    })
  } catch {
    return null
  }
  const at = (time: number) => {
    const parts = Object.fromEntries(
      local.formatToParts(new Date(time)).map((p) => [p.type, p.value])
    )
    const day = weekdays.indexOf(parts.weekday as Weekday)
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      day,
      hour: Number(parts.hour) % 24
    }
  }
  const since = now - windowDays * dayMs
  const sends = rows.flatMap((r) => {
    const parsed = factsSchema.safeParse(r.facts)
    if (!parsed.success) return []
    const time = Date.parse(parsed.data.sentAt)
    return Number.isNaN(time) || time < since || time > now ? [] : [at(time)]
  })
  if (!sends.length) return null

  const grid = weekdays.map(() => Array.from({ length: 24 }, () => 0))
  for (const s of sends) grid[s.day]![s.hour]! += 1
  const byDay = weekdays.map((day, i) => ({
    day,
    emails: grid[i]!.reduce((a, b) => a + b, 0)
  }))
  const monday = (s: { date: string; day: number }) => addDays(s.date, -s.day)
  const thisWeek = monday(at(now))
  const first = sends.map(monday).sort()[0]!
  const counts = new Map<string, number>()
  for (const s of sends) counts.set(monday(s), (counts.get(monday(s)) ?? 0) + 1)
  const byWeek: SendTimeMap['byWeek'] = []
  for (let w = first; w <= thisWeek; w = addDays(w, 7))
    byWeek.push({ weekStart: w, emails: counts.get(w) ?? 0 })
  const usual = grid
    .flatMap((hours, d) =>
      hours.map((emails, hour) => ({ day: weekdays[d]!, hour, emails }))
    )
    .filter((slot) => slot.emails >= 2)
    .sort(
      (a, b) =>
        b.emails - a.emails ||
        weekdays.indexOf(a.day) - weekdays.indexOf(b.day) ||
        a.hour - b.hour
    )
    .slice(0, 3)
  return {
    emails: sends.length,
    perWeek: Math.round((sends.length / Math.max(1, byWeek.length)) * 10) / 10,
    byWeek,
    grid,
    byDay,
    usual,
    quietDays:
      sends.length >= quietDaysFrom
        ? byDay.filter((d) => d.emails === 0).map((d) => d.day)
        : []
  }
}
