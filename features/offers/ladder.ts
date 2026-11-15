/**
 * PLN-040 (owner pick #40, D27): the offer ladder. "Start a sale at 10% and
 * step up over the window instead of the max on day one." The owner's codes
 * are real, so the ladder only ever picks one of them; it never invents a
 * percent. The plan step (lane A) decides how many offer emails there are
 * and on which days; the ladder decides which code each one carries.
 */

/** The plan's offer shape (`Pulse['offers']`): `until` is the last day it works. */
export type LadderOffer = {
  id: string
  code: string
  percent: number
  until: string | null
}

/** Where a sale starts: the lowest code of at least this percent. */
export const ladderStartPercent = 10

const validPercent = (p: number) => Number.isInteger(p) && p >= 1 && p <= 100
const worksOn = (o: LadderOffer, date: string) =>
  o.until === null || o.until >= date

/** Same percent: the one that lasts longest, then by code. */
const better = (a: LadderOffer, b: LadderOffer) =>
  a.until === b.until
    ? a.code.localeCompare(b.code)
    : a.until === null
      ? -1
      : b.until === null
        ? 1
        : b.until.localeCompare(a.until)

/**
 * A code for each offer email, in date order (earliest first). It starts
 * at the lowest code of at least `start` percent (or the lowest code when
 * all are below it) and steps up evenly toward the highest. The percent
 * never goes down, and a code is only used on a day it still works. When
 * no code works on a day without stepping down, that day gets null.
 *
 * Example: codes of 10%, 15% and 25% and three offer emails give 10%, 15%,
 * 25%; one offer email gets 10%.
 */
export function offerLadder<O extends LadderOffer>(
  dates: readonly string[],
  offers: readonly O[],
  start = ladderStartPercent
): { date: string; offer: O | null }[] {
  const days = [...dates].sort()
  const valid = offers.filter((o) => validPercent(o.percent))
  const levels = [...new Set(valid.map((o) => o.percent))].sort((a, b) => a - b)
  // From the lowest code of at least `start`, or every code when none is.
  const first = levels.findIndex((p) => p >= start)
  const rungs = first >= 0 ? levels.slice(first) : levels
  let floor = 0
  return days.map((date, i) => {
    if (rungs.length === 0) return { date, offer: null }
    const target =
      days.length === 1
        ? rungs[0]!
        : rungs[Math.round((i * (rungs.length - 1)) / (days.length - 1))]!
    const usable = valid
      .filter(
        (o) => o.percent >= rungs[0]! && o.percent >= floor && worksOn(o, date)
      )
      .sort((a, b) => a.percent - b.percent || better(a, b))
    const atOrBelow = usable.filter((o) => o.percent <= target)
    const pick = atOrBelow.length
      ? // The highest at or below the planned step, the longest-lasting of those.
        atOrBelow
          .filter((o) => o.percent === atOrBelow.at(-1)!.percent)
          .sort(better)[0]!
      : (usable[0] ?? null)
    if (pick) floor = pick.percent
    return { date, offer: pick }
  })
}

/**
 * For the plan's checks: the indexes (in the order given) of offer emails
 * whose percent is lower than an offer email on an earlier day. Emails on
 * the same day (different audiences) are not a step down.
 */
export function ladderStepsDown(
  slots: readonly { date: string; percent: number | null }[]
): number[] {
  const order = slots
    .map((s, index) => ({ ...s, index }))
    .filter((s): s is typeof s & { percent: number } => s.percent !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index)
  const down: number[] = []
  let highestBefore = 0
  let dayHighest = 0
  let day = ''
  for (const s of order) {
    if (s.date !== day) {
      highestBefore = Math.max(highestBefore, dayHighest)
      dayHighest = 0
      day = s.date
    }
    if (s.percent < highestBefore) down.push(s.index)
    dayHighest = Math.max(dayHighest, s.percent)
  }
  return down.sort((a, b) => a - b)
}
