import { factsSchema, summaryWindowDays } from './brand-summary'
import type { Angle } from './facts'
import { weekdays } from './send-times'

/**
 * CMP-047 (owner pick #47, D27): "Layouts a brand sends again and again are
 * probably working; mark them as winners." A layout is the order of an
 * email's sections (INB-003's block sequence) without the header, the
 * announcement bar, the sign-off, the footer and unnamed parts at either
 * end, with a block repeated in a row counted once; an unnamed part between
 * content stays (as `unsure`), so it never merges with a real layout.
 *
 * A brand's layout is a winner when it carried at least `winnerAt`
 * different campaigns (resends with the same subject count once) spread
 * over at least `winnerSpanDays` days. A sale and its resends, even across
 * a weekend into Monday, is a burst, not a habit.
 */
export const winnerAt = 3
export const winnerSpanDays = 7
export const maxWindowDays = 366

export type Layout = {
  /** The sections in order, e.g. ["hero_image", "product_grid_2col", "text"]. */
  blocks: string[]
  emails: number
  /** Different campaigns: emails with different subjects (resends counted once). */
  campaigns: number
  /** Different weeks (Monday first, reader's timezone) it was sent in. */
  weeks: number
  /** Days from its first to its last send. */
  spanDays: number
  /** When it was last sent (ISO). */
  lastSeen: string
  /** Ids of its emails, when the rows carry them, newest first, each once. */
  ids: string[]
  /** The angles of its emails, most used first. */
  angles: { angle: Angle; emails: number }[]
  winner: boolean
}

const chrome = new Set(['announcement_bar', 'header_logo', 'signoff'])
const isChrome = (block: string) =>
  chrome.has(block) || block.startsWith('footer')
const dayMs = 86_400_000

/**
 * The layout of a block sequence: chrome left out, unnamed parts left out at
 * either end only, a block repeated in a row once.
 */
export function layoutOf(blockSequence: readonly string[]): string[] {
  const content = blockSequence.filter((b) => !isChrome(b))
  let start = 0
  let end = content.length
  while (start < end && content[start] === 'unsure') start++
  while (end > start && content[end - 1] === 'unsure') end--
  const out: string[] = []
  for (const block of content.slice(start, end))
    if (out.at(-1) !== block) out.push(block)
  return out
}

/** A subject without case, spacing or a resend prefix ("Last chance: ..."). */
const resendPrefix =
  /^(?:(?:re|fwd?|reminder|last chance|final hours|ends tonight|ending soon|don['’]t miss (?:out|it)|still time|last call)\s*[:\-–—!]\s*)+/
const subjectKey = (subject: string) =>
  subject
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(resendPrefix, '')
    .trim()

/**
 * One brand's layouts in the last `windowDays` days (1 to 366), winners
 * first, then by campaigns, emails and the most recent; a layout with no
 * content blocks is left out. A row with the same id counts once. Null for
 * an unreal timezone, a bad time or window.
 */
export function layoutWinners(
  rows: readonly { id?: string; facts: unknown }[],
  {
    now,
    timezone,
    windowDays = summaryWindowDays
  }: { now: number; timezone: string; windowDays?: number }
): Layout[] | null {
  if (
    !Number.isFinite(now) ||
    !Number.isInteger(windowDays) ||
    windowDays < 1 ||
    windowDays > maxWindowDays
  )
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
    const offset = weekdays.indexOf(p.weekday as (typeof weekdays)[number])
    return Number.isNaN(day) || offset < 0
      ? null
      : new Date(day - offset * dayMs).toISOString().slice(0, 10)
  }
  const since = now - windowDays * dayMs
  const seen = new Set<string>()
  const groups = new Map<
    string,
    {
      blocks: string[]
      sends: {
        time: number
        week: string
        id?: string
        angle: Angle
        subject: string
      }[]
    }
  >()
  for (const row of rows) {
    const id = typeof row.id === 'string' && row.id ? row.id : undefined
    if (id && seen.has(id)) continue
    const parsed = factsSchema.safeParse(row.facts)
    if (!parsed.success) continue
    const time = Date.parse(parsed.data.sentAt)
    if (Number.isNaN(time) || time < since || time > now) continue
    const week = weekOf(time)
    const blocks = layoutOf(parsed.data.blockSequence)
    if (!week || blocks.length === 0) continue
    if (id) seen.add(id)
    const key = blocks.join('>')
    const group = groups.get(key) ?? { blocks, sends: [] }
    group.sends.push({
      time,
      week,
      id,
      angle: parsed.data.angle as Angle,
      subject: subjectKey(parsed.data.subject)
    })
    groups.set(key, group)
  }
  return [...groups.values()]
    .map(({ blocks, sends }) => {
      const newest = [...sends].sort((a, b) => b.time - a.time)
      const first = newest.at(-1)!.time
      const last = newest[0]!.time
      const campaigns = new Set(sends.map((s) => s.subject)).size
      const spanDays = Math.floor((last - first) / dayMs)
      const angleCounts = new Map<Angle, number>()
      for (const s of sends)
        angleCounts.set(s.angle, (angleCounts.get(s.angle) ?? 0) + 1)
      return {
        blocks,
        emails: sends.length,
        campaigns,
        weeks: new Set(sends.map((s) => s.week)).size,
        spanDays,
        lastSeen: new Date(last).toISOString(),
        ids: newest.flatMap((s) => (s.id ? [s.id] : [])),
        angles: [...angleCounts.entries()]
          .map(([angle, emails]) => ({ angle, emails }))
          .sort(
            (a, b) => b.emails - a.emails || a.angle.localeCompare(b.angle)
          ),
        winner: campaigns >= winnerAt && last - first >= winnerSpanDays * dayMs
      }
    })
    .sort(
      (a, b) =>
        Number(b.winner) - Number(a.winner) ||
        b.campaigns - a.campaigns ||
        b.emails - a.emails ||
        Date.parse(b.lastSeen) - Date.parse(a.lastSeen) ||
        a.blocks.join('>').localeCompare(b.blocks.join('>'))
    )
}

/**
 * Layouts that at least two of the given brands each send as winners:
 * the strongest sign a layout works in this industry. Most brands first;
 * a brand given twice counts once.
 */
export function commonWinners(
  brands: readonly { domain: string; layouts: readonly Layout[] }[]
): { blocks: string[]; domains: string[]; emails: number }[] {
  const byLayout = new Map<
    string,
    { blocks: string[]; emails: Map<string, number> }
  >()
  for (const brand of brands)
    for (const layout of brand.layouts) {
      if (!layout.winner) continue
      const key = layout.blocks.join('>')
      const entry = byLayout.get(key) ?? {
        blocks: [...layout.blocks],
        emails: new Map<string, number>()
      }
      entry.emails.set(
        brand.domain,
        Math.max(entry.emails.get(brand.domain) ?? 0, layout.emails)
      )
      byLayout.set(key, entry)
    }
  return [...byLayout.values()]
    .filter((e) => e.emails.size >= 2)
    .map((e) => ({
      blocks: e.blocks,
      domains: [...e.emails.keys()].sort(),
      emails: [...e.emails.values()].reduce((a, b) => a + b, 0)
    }))
    .sort(
      (a, b) =>
        b.domains.length - a.domains.length ||
        b.emails - a.emails ||
        a.blocks.join('>').localeCompare(b.blocks.join('>'))
    )
}
