import { factsSchema, summaryWindowDays } from './brand-summary'
import type { Angle } from './facts'

/**
 * CMP-047 (owner pick #47, D27): "Layouts a brand sends again and again are
 * probably working; mark them as winners." A layout is the order of an
 * email's sections (INB-003's block sequence) without the header, the
 * announcement bar, the footer or unsure parts, with a block repeated in a
 * row counted once. A brand's layout is a winner when it sent it at least
 * `winnerAt` times in at least `winnerWeeks` different weeks (a sale and its
 * resends in one week is a burst, not a habit).
 */
export const winnerAt = 3
export const winnerWeeks = 2

export type Layout = {
  /** The sections in order, e.g. ["hero_image", "product_grid", "text"]. */
  blocks: string[]
  emails: number
  /** Different weeks (Monday first, reader's timezone) it was sent in. */
  weeks: number
  /** When it was last sent (ISO). */
  lastSeen: string
  /** Ids of its emails, when the rows carry them, newest first. */
  ids: string[]
  /** The angles of its emails, most used first. */
  angles: { angle: Angle; emails: number }[]
  winner: boolean
}

const chrome = new Set(['announcement_bar', 'header_logo', 'unsure'])
const isChrome = (block: string) =>
  chrome.has(block) || block.startsWith('footer')
const dayMs = 86_400_000
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** The layout of a block sequence: chrome left out, a block repeated in a row once. */
export function layoutOf(blockSequence: readonly string[]): string[] {
  const out: string[] = []
  for (const block of blockSequence)
    if (!isChrome(block) && out.at(-1) !== block) out.push(block)
  return out
}

/**
 * One brand's layouts in the last `windowDays` days, winners first, then by
 * emails and the most recent; a layout with no content blocks is left out.
 * Null for an unreal timezone or a bad time.
 */
export function layoutWinners(
  rows: readonly { id?: string; facts: unknown }[],
  {
    now,
    timezone,
    windowDays = summaryWindowDays
  }: { now: number; timezone: string; windowDays?: number }
): Layout[] | null {
  if (!Number.isFinite(now) || !Number.isInteger(windowDays) || windowDays < 1)
    return null
  let local: Intl.DateTimeFormat
  try {
    local = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short'
    })
  } catch {
    return null
  }
  const weekOf = (time: number) => {
    const p = Object.fromEntries(
      local.formatToParts(new Date(time)).map((x) => [x.type, x.value])
    )
    const day = Date.parse(`${p.year}-${p.month}-${p.day}T00:00:00Z`)
    return Number.isNaN(day)
      ? null
      : new Date(day - weekdays.indexOf(p.weekday!) * dayMs)
          .toISOString()
          .slice(0, 10)
  }
  const since = now - windowDays * dayMs
  const groups = new Map<
    string,
    {
      blocks: string[]
      sends: { time: number; week: string; id?: string; angle: Angle }[]
    }
  >()
  for (const row of rows) {
    const parsed = factsSchema.safeParse(row.facts)
    if (!parsed.success) continue
    const time = Date.parse(parsed.data.sentAt)
    if (Number.isNaN(time) || time < since || time > now) continue
    const week = weekOf(time)
    const blocks = layoutOf(parsed.data.blockSequence)
    if (!week || blocks.length === 0) continue
    const key = blocks.join('>')
    const group = groups.get(key) ?? { blocks, sends: [] }
    group.sends.push({
      time,
      week,
      id: typeof row.id === 'string' ? row.id : undefined,
      angle: parsed.data.angle as Angle
    })
    groups.set(key, group)
  }
  return [...groups.values()]
    .map(({ blocks, sends }) => {
      const newest = [...sends].sort((a, b) => b.time - a.time)
      const weeks = new Set(sends.map((s) => s.week)).size
      const angleCounts = new Map<Angle, number>()
      for (const s of sends)
        angleCounts.set(s.angle, (angleCounts.get(s.angle) ?? 0) + 1)
      return {
        blocks,
        emails: sends.length,
        weeks,
        lastSeen: new Date(newest[0]!.time).toISOString(),
        ids: newest.flatMap((s) => (s.id ? [s.id] : [])),
        angles: [...angleCounts.entries()]
          .map(([angle, emails]) => ({ angle, emails }))
          .sort(
            (a, b) => b.emails - a.emails || a.angle.localeCompare(b.angle)
          ),
        winner: sends.length >= winnerAt && weeks >= winnerWeeks
      }
    })
    .sort(
      (a, b) =>
        Number(b.winner) - Number(a.winner) ||
        b.emails - a.emails ||
        b.lastSeen.localeCompare(a.lastSeen)
    )
}

/**
 * Layouts that at least two of the given brands each send as winners:
 * the strongest sign a layout works in this industry. Most brands first.
 */
export function commonWinners(
  brands: readonly { domain: string; layouts: readonly Layout[] }[]
): { blocks: string[]; domains: string[]; emails: number }[] {
  const byLayout = new Map<
    string,
    { blocks: string[]; domains: Set<string>; emails: number }
  >()
  for (const brand of brands)
    for (const layout of brand.layouts) {
      if (!layout.winner) continue
      const key = layout.blocks.join('>')
      const entry = byLayout.get(key) ?? {
        blocks: layout.blocks,
        domains: new Set<string>(),
        emails: 0
      }
      entry.domains.add(brand.domain)
      entry.emails += layout.emails
      byLayout.set(key, entry)
    }
  return [...byLayout.values()]
    .filter((e) => e.domains.size >= 2)
    .map((e) => ({
      blocks: e.blocks,
      domains: [...e.domains].sort(),
      emails: e.emails
    }))
    .sort(
      (a, b) =>
        b.domains.length - a.domains.length ||
        b.emails - a.emails ||
        a.blocks.join('>').localeCompare(b.blocks.join('>'))
    )
}
