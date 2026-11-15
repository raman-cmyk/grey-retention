/**
 * PLN-040 (owner pick #40, D27): the offer ladder. "Start a sale at 10% and
 * step up over the window instead of the max on day one." The owner's codes
 * are real, so the ladder only ever picks one of them; it never invents a
 * percent. The plan step (lane A) decides how many offer emails there are
 * and on which days; the ladder decides which code each one carries.
 */

/**
 * The plan's offer shape (`Pulse['offers'][number]`, kept in step by hand):
 * `until` is the last day it works (YYYY-MM-DD, inclusive), null for no end.
 */
export type LadderOffer = {
  id: string
  code: string
  percent: number
  until: string | null
}

/** Where a sale starts: the lowest code of at least this percent. */
export const ladderStartPercent = 10

const isoDay = /^\d{4}-\d{2}-\d{2}$/
const validPercent = (p: number) => Number.isInteger(p) && p >= 1 && p <= 100
const worksOn = (o: LadderOffer, date: string) =>
  o.until === null || o.until >= date

/** Same percent: the one that lasts longest, then by code (plain order). */
const better = (a: LadderOffer, b: LadderOffer) =>
  a.until === b.until
    ? a.code < b.code
      ? -1
      : a.code > b.code
        ? 1
        : 0
    : a.until === null
      ? -1
      : b.until === null
        ? 1
        : a.until > b.until
          ? -1
          : 1

/**
 * A code for each offer email, returned in the order given (`index` is the
 * position in `dates`). Emails on the same day get the same code. Over the
 * offer days, earliest first, it starts at the lowest code of at least
 * `start` percent (or the lowest code when all are below it) and steps up
 * toward the highest, rounding the middle steps down (lower is safer). The
 * percent never goes down, a code is only used on a day it still works,
 * and it does not step up to a percent no code can hold on the later
 * offer days. A day gets null only when no code works on it without
 * stepping down; a `date` that is not YYYY-MM-DD gets null.
 *
 * Only codes that work on at least one of the offer days count.
 *
 * Example: codes of 10%, 15% and 25% over three offer days give 10%, 15%,
 * 25%; one offer email gets 10%.
 */
export function offerLadder<O extends LadderOffer>(
  dates: readonly string[],
  offers: readonly O[],
  start = ladderStartPercent
): { index: number; date: string; offer: O | null }[] {
  const days = [...new Set(dates.filter((d) => isoDay.test(d)))].sort()
  const live = offers.filter(
    (o) => validPercent(o.percent) && days.some((d) => worksOn(o, d))
  )
  const levels = [...new Set(live.map((o) => o.percent))].sort((a, b) => a - b)
  const first = levels.findIndex((p) => p >= start)
  const rungs = first >= 0 ? levels.slice(first) : levels
  const lowest = rungs[0] ?? 0
  const byDay = new Map<string, O | null>()
  let floor = 0
  days.forEach((date, i) => {
    if (rungs.length === 0) return byDay.set(date, null)
    const step =
      days.length === 1
        ? 0
        : Math.ceil((i * (rungs.length - 1)) / (days.length - 1) - 0.5)
    const target = rungs[step]!
    const later = days.slice(i + 1)
    // Some code at this percent or more still works on every later day.
    const holdable = (p: number) =>
      later.every((d) => live.some((o) => o.percent >= p && worksOn(o, d)))
    const today = live
      .filter(
        (o) => o.percent >= lowest && o.percent >= floor && worksOn(o, date)
      )
      .sort((a, b) => a.percent - b.percent || better(a, b))
    const highest = (list: O[]) => {
      const top = list.at(-1)
      return top
        ? list.filter((o) => o.percent === top.percent).sort(better)[0]!
        : null
    }
    const atOrBelow = today.filter((o) => o.percent <= target)
    const pick =
      highest(atOrBelow.filter((o) => holdable(o.percent))) ??
      highest(atOrBelow) ??
      today.find((o) => holdable(o.percent)) ??
      today[0] ??
      null
    if (pick) floor = pick.percent
    byDay.set(date, pick)
  })
  return dates.map((date, index) => ({
    index,
    date,
    offer: byDay.get(date) ?? null
  }))
}

/**
 * For the plan's checks: the indexes (in the order given) of offer emails
 * whose percent is lower than one sent earlier (by date, then local time
 * when given). Emails sent at the same moment are not a step down. Pass
 * offer emails already planned too, so a new plan does not step down from
 * them.
 */
export function ladderStepsDown(
  slots: readonly { date: string; time?: string; percent: number | null }[]
): number[] {
  const at = (s: { date: string; time?: string }) => `${s.date}T${s.time ?? ''}`
  const order = slots
    .map((s, index) => ({ ...s, index, moment: at(s) }))
    .filter((s): s is typeof s & { percent: number } => s.percent !== null)
    .sort((a, b) =>
      a.moment < b.moment ? -1 : a.moment > b.moment ? 1 : a.index - b.index
    )
  const down: number[] = []
  let highestBefore = 0
  let momentHighest = 0
  let moment = ''
  for (const s of order) {
    if (s.moment !== moment) {
      highestBefore = Math.max(highestBefore, momentHighest)
      momentHighest = 0
      moment = s.moment
    }
    if (s.percent < highestBefore) down.push(s.index)
    momentHighest = Math.max(momentHighest, s.percent)
  }
  return down.sort((a, b) => a - b)
}
