/**
 * PICK-97 (owner pick #97, "Best send time per segment"): each planned
 * email's suggested send time is its audience's best time (counted from
 * the store's Klaviyo history, features/onboarding/history/send-times.ts),
 * and two emails the same day are never closer than `minHoursApart` (a
 * list and a segment can hold the same people). Code sets the time, after
 * the calendar rules, whatever an agent wrote. The owner still schedules in
 * Klaviyo (D17): GROS only suggests.
 */

export const sendTimeBases = ['segment', 'store', 'usual', 'default'] as const
export type SendTimeBasis = (typeof sendTimeBases)[number]

/**
 * How sure a best hour is: `clear` beat every other hour tried enough by a
 * margin; `close` did best, but not by much; `only` was the one hour tried
 * enough; `none` is no counted hour (the usual time or the default).
 */
export const timeStrengths = ['clear', 'close', 'only', 'none'] as const
export type TimeStrength = (typeof timeStrengths)[number]

/** One audience's send time, as "Plan next 15 days" takes it. */
export type PlanSendTime = {
  audienceId: string
  /** HH:00 store time, inside the send hours. */
  time: string
  basis: SendTimeBasis
  strength: TimeStrength
  /** Other hours were tried, if fewer times than needed to compare. */
  othersTried: boolean
  /** The weekday this audience's own people open most; null when not known. */
  weekday: string | null
}

/** Why a planned email has its time (saved with the plan). */
export type SlotTiming = {
  basis: SendTimeBasis
  strength: TimeStrength
  othersTried: boolean
  /** The audience's own best time, before any move. */
  best: string
  /** Moved off `best` to keep two emails that day apart. */
  moved: boolean
}

/** Two emails on one day are at least this many hours apart. */
export const minHoursApart = 3
const firstHour = 7
const lastHour = 21

const hourOf = (time: string) => Number(time.slice(0, 2))
const at = (hour: number, minutes: string) =>
  `${String(hour).padStart(2, '0')}:${minutes}`

/** The stronger the reason for a time, the earlier it keeps it. */
function rank(t: PlanSendTime | undefined) {
  if (!t) return 9
  if (t.basis === 'segment')
    return t.strength === 'clear' ? 0 : t.strength === 'close' ? 1 : 2
  if (t.basis === 'store') return 3
  return t.basis === 'usual' ? 4 : 5
}

/**
 * The slots with their audience's send time, each one at least
 * `minHoursApart` from the others that day. The email with the strongest
 * reason for its time keeps it (a clear segment time before a fallback),
 * then the earlier time; another one takes the nearest hour that fits,
 * later hours first on a tie. Without send times (the sample store, or
 * nothing counted yet) the slots are unchanged. A day too full to keep
 * them apart keeps the best times.
 */
export function withSendTimes<
  S extends { date: string; time: string; audienceId: string }
>(
  slots: readonly S[],
  times: readonly PlanSendTime[] | undefined
): (S & { timing?: SlotTiming })[] {
  if (!times?.length) return [...slots]
  const byAudience = new Map(times.map((t) => [t.audienceId, t]))
  const wanted = (s: S) => byAudience.get(s.audienceId)?.time ?? s.time
  const taken = new Map<string, number[]>()
  const order = slots
    .map((s, i) => ({ s, i }))
    .sort(
      (a, b) =>
        a.s.date.localeCompare(b.s.date) ||
        rank(byAudience.get(a.s.audienceId)) -
          rank(byAudience.get(b.s.audienceId)) ||
        wanted(a.s).localeCompare(wanted(b.s)) ||
        a.i - b.i
    )
  const out: (S & { timing?: SlotTiming })[] = [...slots]
  for (const { s, i } of order) {
    const t = byAudience.get(s.audienceId)
    const best = wanted(s)
    const day = taken.get(s.date) ?? []
    const fits = (h: number) =>
      h >= firstHour &&
      h <= lastHour &&
      day.every((d) => Math.abs(d - h) >= minHoursApart)
    const want = hourOf(best)
    let hour = want
    if (!fits(want))
      for (let step = 1; step <= lastHour - firstHour; step++) {
        if (fits(want + step)) {
          hour = want + step
          break
        }
        if (fits(want - step)) {
          hour = want - step
          break
        }
      }
    taken.set(s.date, [...day, hour])
    const time = at(hour, best.slice(3))
    out[i] = {
      ...s,
      time,
      ...(t
        ? {
            timing: {
              basis: t.basis,
              strength: t.strength,
              othersTried: t.othersTried,
              best,
              moved: time !== best
            }
          }
        : {})
    }
  }
  return out
}

/** "9:00 am" for "09:00". */
function clock(time: string) {
  const h = hourOf(time)
  return `${h % 12 === 0 ? 12 : h % 12}:${time.slice(3)} ${h < 12 ? 'am' : 'pm'}`
}

/**
 * Why an email has its time, in the owner's words, for the Plan row:
 * "when this group opens and clicks most", or what the time falls back on.
 * Each claim is only made when the history shows it.
 */
export function timingWords(t: SlotTiming) {
  if (t.moved)
    return `moved from ${clock(t.best)} so two emails that day are not too close`
  if (t.basis === 'segment')
    return t.strength === 'clear'
      ? 'when this group opens and clicks most'
      : t.strength === 'close'
        ? 'the time that did best so far for this group'
        : t.othersTried
          ? 'the only time this group has had more than once'
          : 'the time this group has always had; no other time tried yet'
  if (t.basis === 'store') {
    const lead = 'not enough history for this group; '
    return (
      lead +
      (t.strength === 'clear'
        ? 'when your subscribers open and click most'
        : t.strength === 'close'
          ? 'the time that did best so far for your store'
          : 'your store’s best hour so far')
    )
  }
  return t.basis === 'usual'
    ? 'not enough history yet; your usual send time'
    : 'not enough history yet; a standard morning time'
}
