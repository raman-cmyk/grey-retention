import { z } from 'zod'
import type { PlanSendTime, TimeStrength } from '@/features/strategy/send-times'
import { minRecipients, sendParts, type SentEmail } from './facts'

/**
 * PICK-97 (owner pick #97, "Best send time per segment"): from what the
 * store already sent with Klaviyo, the hours and weekdays when each list or
 * segment's people open and click most, in the store's timezone. Counted
 * in code from the campaign report (one row per sent email: recipients,
 * unique opens, unique clicks) and each campaign's audiences; no extra
 * Klaviyo report is asked.
 *
 * Hours are only ever compared between sends to the same people: an
 * audience's own row counts only the emails sent to that audience alone (an
 * email to several lists and segments gives its results to none of them:
 * `shared`), and the store's row compares hours within its most-sent
 * audience set (`within`), never "the engaged at 18:00" against "the whole
 * list at 10:00".
 *
 * Facts (counts per hour and weekday, first and last send) are kept apart
 * from the recommendation (the best hour, the best weekday, and why there
 * is none). A recommendation needs enough history: `minSends` counted sends,
 * and an hour (or weekday) sent to at least `minSlotSends` times inside the
 * send hours. Otherwise `reason` says why ("not enough history"), and the
 * planner falls back to the store's best hour, then the store's usual hour,
 * then a default (`resolveSendTimes`). The best hour only counts as a clear
 * winner (`compared`) when it beat every other hour tried enough by
 * `minMargin`; otherwise it is "the time that did best so far".
 *
 * Opens are inflated by Apple Mail Privacy Protection (machine opens fire
 * when the mail is delivered, whoever reads it), so a click counts as
 * `clickWeight` opens, and opens a source flags as machine opens
 * (`machineOpens`) are taken off. Klaviyo's campaign report does not flag
 * them today: the field stays null and clicks carry the weight.
 *
 * A send at each person's own clock time (Klaviyo's local-timezone send)
 * counts by that clock hour: the planner suggests a clock time too, and that
 * is the hour its people saw it.
 */

export const sendTimeRules = {
  /** Counted sends an audience needs before it gets its own time. */
  minSends: 3,
  /** Sends an hour (or weekday) needs before it can be the best one. */
  minSlotSends: 2,
  /** The best hour must beat every rival by this share to be clear. */
  minMargin: 0.1,
  /** An email this new is still collecting its opens: not counted yet. */
  settleHours: 48,
  /** One click counts as this many opens (clicks are never machine-made). */
  clickWeight: 10,
  /** The hours a recommendation may name (the planner's send hours). */
  fromHour: 7,
  toHour: 21
} as const

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

/** The whole store's row. */
export const storeWide = '*'
/** At most this many audiences are kept (the history's own limit). */
export const maxAudiences = 120

/** One sent email, as the counting reads it. */
export type SendSample = {
  sentAt: string
  strategy: SentEmail['strategy']
  recipients: number | null
  opens: number | null
  clicks: number | null
  /**
   * Opens a source flagged as machine (Apple privacy) opens; null or
   * missing when nothing flagged them.
   */
  machineOpens?: number | null
  /** The lists and segments it went to (Klaviyo ids); empty: not known. */
  audienceIds: readonly string[]
}

const audienceId = z.string().regex(/^[A-Za-z0-9]{1,64}$/)
/** Counts can be large for a big store: at most 10^15 (safe in JS). */
const count = z.number().int().nonnegative().max(1e15)
const sendCount = z.number().int().min(0).max(300)
const tallyShape = {
  sends: z.number().int().min(1).max(300),
  recipients: count,
  opens: count,
  clicks: count,
  machineOpens: count
}
const hourFacts = z.strictObject({
  hour: z.number().int().min(0).max(23),
  ...tallyShape
})
const weekdayFacts = z.strictObject({
  weekday: z.enum(weekdays),
  ...tallyShape
})

/** What was counted (and compared): the facts, never a recommendation. */
export const sendTimeFacts = z.strictObject({
  /** Sends counted and compared. */
  sends: sendCount,
  /**
   * Sends to it not counted: Klaviyo picked the time per person, too few
   * recipients, no results read, or still collecting opens.
   */
  leftOut: sendCount,
  /**
   * Counted sends that went to other people: for an audience, those it got
   * together with other audiences; for the store, those to another
   * audience set than `within`.
   */
  shared: sendCount,
  /** The audiences the counted sends went to (empty: not known). */
  within: z.array(audienceId).max(50),
  firstSentAt: z.iso.datetime({ offset: true }).nullable(),
  lastSentAt: z.iso.datetime({ offset: true }).nullable(),
  recipients: count,
  opens: count,
  clicks: count,
  machineOpens: count,
  hours: z.array(hourFacts).max(24),
  weekdays: z.array(weekdayFacts).max(7)
})
export type SendTimeFacts = z.infer<typeof sendTimeFacts>

export const sendTimeReasons = [
  'enough',
  'few_sends',
  'no_repeated_time',
  'out_of_hours'
] as const

/** One audience's (or the store's) facts and recommendation. */
export const sendTimeEntry = z
  .strictObject({
    audienceId: z.union([z.literal('*'), audienceId]),
    facts: sendTimeFacts,
    /** The hour its people open and click most; null: not enough history. */
    bestHour: z
      .number()
      .int()
      .min(sendTimeRules.fromHour)
      .max(sendTimeRules.toHour)
      .nullable(),
    /** The weekday they open and click most; null: not enough history. */
    bestWeekday: z.enum(weekdays).nullable(),
    /** Other hours tried enough to compare with the best one. */
    rivals: z.number().int().min(0).max(14),
    /** The best hour beat every rival by `minMargin`. */
    compared: z.boolean(),
    reason: z.enum(sendTimeReasons)
  })
  .refine((e) => (e.reason === 'enough') === (e.bestHour !== null))
  .refine((e) => e.bestHour !== null || (!e.compared && e.rivals === 0))
  .refine((e) => !e.compared || e.rivals >= 1)
  .refine((e) => e.reason !== 'few_sends' || e.bestWeekday === null)
export type SendTimeEntry = z.infer<typeof sendTimeEntry>

type Tally = {
  sends: number
  recipients: number
  opens: number
  clicks: number
  machineOpens: number
}
const empty = (): Tally => ({
  sends: 0,
  recipients: 0,
  opens: 0,
  clicks: 0,
  machineOpens: 0
})
const add = (t: Tally, s: Counted) => {
  t.sends++
  t.recipients += s.recipients
  t.opens += s.opens
  t.clicks += s.clicks
  t.machineOpens += s.machineOpens
}

/**
 * How much a slot's people engaged, per recipient: clicks weighted, and
 * opens without those flagged as machine opens.
 */
export function engagement(t: Tally) {
  if (t.recipients <= 0) return 0
  const opens = Math.max(0, t.opens - Math.min(t.opens, t.machineOpens))
  return (sendTimeRules.clickWeight * t.clicks + opens) / t.recipients
}

type Counted = {
  at: number
  hour: number
  weekday: Weekday
  recipients: number
  opens: number
  clicks: number
  machineOpens: number
}

/**
 * The best slot among those tried enough and allowed, with how many others
 * it was compared with and whether it beat each by `minMargin`.
 */
function best<K extends string | number>(
  slots: Map<K, Tally>,
  allowed: (key: K) => boolean,
  order: (a: K, b: K) => number
) {
  const enough = [...slots.entries()].filter(
    ([, t]) => t.sends >= sendTimeRules.minSlotSends
  )
  const eligible = enough.filter(([k]) => allowed(k))
  eligible.sort(
    ([ka, a], [kb, b]) =>
      engagement(b) - engagement(a) ||
      b.clicks / Math.max(1, b.recipients) -
        a.clicks / Math.max(1, a.recipients) ||
      b.sends - a.sends ||
      order(ka, kb)
  )
  const top = eligible[0]
  const second = eligible[1]
  return {
    key: top?.[0] ?? null,
    rivals: Math.max(0, eligible.length - 1),
    clear:
      !!top &&
      !!second &&
      engagement(top[1]) >=
        engagement(second[1]) * (1 + sendTimeRules.minMargin) &&
      engagement(top[1]) > 0,
    /** Hours were tried enough, but none inside the allowed ones. */
    outside: enough.length > 0 && eligible.length === 0
  }
}

/** The local hour and weekday of a counted send; null when not counted. */
function counted(s: SendSample, timezone: string, now: number): Counted | null {
  const at = Date.parse(s.sentAt)
  if (
    s.strategy === 'optimized' ||
    Number.isNaN(at) ||
    now - at < sendTimeRules.settleHours * 3_600_000 ||
    s.recipients === null ||
    s.recipients < minRecipients ||
    s.opens === null ||
    s.clicks === null
  )
    return null
  const parts = sendParts(s.sentAt, s.strategy, timezone)
  const weekday = weekdays.find((w) => w === parts.weekday)
  if (!weekday || !Number.isInteger(parts.hour)) return null
  return {
    at,
    hour: parts.hour,
    weekday,
    recipients: s.recipients,
    opens: s.opens,
    clicks: s.clicks,
    machineOpens: Math.max(0, s.machineOpens ?? 0)
  }
}

function entry(
  audienceId: string,
  kept: readonly Counted[],
  extra: { leftOut: number; shared: number; within: string[] },
  iso: (at: number) => string
): SendTimeEntry {
  const total = empty()
  const hours = new Map<number, Tally>()
  const days = new Map<Weekday, Tally>()
  for (const s of kept) {
    add(total, s)
    const h = hours.get(s.hour) ?? empty()
    add(h, s)
    hours.set(s.hour, h)
    const d = days.get(s.weekday) ?? empty()
    add(d, s)
    days.set(s.weekday, d)
  }
  const times = kept.map((s) => s.at)
  // `total.sends` is the counted sends.
  const facts: SendTimeFacts = {
    ...total,
    leftOut: Math.min(300, extra.leftOut),
    shared: Math.min(300, extra.shared),
    within: extra.within.slice(0, 50),
    firstSentAt: times.length ? iso(Math.min(...times)) : null,
    lastSentAt: times.length ? iso(Math.max(...times)) : null,
    hours: [...hours.entries()]
      .sort(([a], [b]) => a - b)
      .map(([hour, t]) => ({ hour, ...t })),
    weekdays: weekdays.flatMap((weekday) => {
      const t = days.get(weekday)
      return t ? [{ weekday, ...t }] : []
    })
  }
  const none = {
    audienceId,
    facts,
    bestHour: null,
    rivals: 0,
    compared: false
  }
  if (kept.length < sendTimeRules.minSends)
    return { ...none, bestWeekday: null, reason: 'few_sends' }
  const hour = best(
    hours,
    (h) => h >= sendTimeRules.fromHour && h <= sendTimeRules.toHour,
    (a, b) => a - b
  )
  const day = best(
    days,
    () => true,
    (a, b) => weekdays.indexOf(a) - weekdays.indexOf(b)
  )
  if (hour.key === null)
    return {
      ...none,
      bestWeekday: day.key,
      reason: hour.outside ? 'out_of_hours' : 'no_repeated_time'
    }
  return {
    audienceId,
    facts,
    bestHour: hour.key,
    bestWeekday: day.key,
    rivals: hour.rivals,
    compared: hour.clear,
    reason: 'enough'
  }
}

const validId = (id: string) => /^[A-Za-z0-9]{1,64}$/.test(id)
/** One send's audience set, the same whatever the order or repeats. */
const setOf = (s: SendSample) =>
  [...new Set(s.audienceIds.filter(validId))].sort()

/**
 * The store's row first, then one per audience that got a send in the
 * history read, most counted sends first (at most `maxAudiences`). Pure:
 * the same history always gives the same answer.
 */
export function sendTimes(
  samples: readonly SendSample[],
  timezone: string,
  now: number
): SendTimeEntry[] {
  const iso = (at: number) =>
    new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const rows = samples.map((s) => ({
    set: setOf(s),
    counted: counted(s, timezone, now)
  }))

  // Each audience: its sends alone counted; with others, shared.
  const byAudience = new Map<
    string,
    { kept: Counted[]; leftOut: number; shared: number }
  >()
  for (const r of rows)
    for (const id of r.set) {
      const a = byAudience.get(id) ?? { kept: [], leftOut: 0, shared: 0 }
      if (r.set.length > 1) {
        if (r.counted) a.shared++
      } else if (r.counted) a.kept.push(r.counted)
      else a.leftOut++
      byAudience.set(id, a)
    }
  const audiences = [...byAudience.entries()]
    .map(([id, a]) =>
      entry(
        id,
        a.kept,
        { leftOut: a.leftOut, shared: a.shared, within: [id] },
        iso
      )
    )
    .sort(
      (a, b) =>
        b.facts.sends - a.facts.sends ||
        (a.audienceId < b.audienceId ? -1 : a.audienceId > b.audienceId ? 1 : 0)
    )
    .slice(0, maxAudiences)

  // The store: its most-sent audience set (an unknown audience is a set
  // of its own), so its hours are compared between the same people.
  const sets = new Map<string, { ids: string[]; kept: Counted[] }>()
  for (const r of rows) {
    if (!r.counted) continue
    const key = r.set.join(',')
    const s = sets.get(key) ?? { ids: r.set, kept: [] }
    s.kept.push(r.counted)
    sets.set(key, s)
  }
  const recipients = (k: Counted[]) => k.reduce((n, c) => n + c.recipients, 0)
  // A known audience set with enough sends before sends whose audiences
  // were not read (those may have gone to anyone).
  const known = [...sets.entries()].filter(
    ([key, s]) => key !== '' && s.kept.length >= sendTimeRules.minSends
  )
  const main = (known.length ? known : [...sets.entries()]).sort(
    ([ka, a], [kb, b]) =>
      b.kept.length - a.kept.length ||
      recipients(b.kept) - recipients(a.kept) ||
      (ka < kb ? -1 : ka > kb ? 1 : 0)
  )[0]?.[1]
  const countedAll = rows.filter((r) => r.counted).length
  const store = entry(
    storeWide,
    main?.kept ?? [],
    {
      leftOut: rows.length - countedAll,
      shared: countedAll - (main?.kept.length ?? 0),
      within: main?.ids ?? []
    },
    iso
  )
  return [store, ...audiences]
}

/** The sent emails with their campaigns' audiences, as `sendTimes` reads them. */
export function sendSamples(
  sent: readonly SentEmail[],
  audiences: readonly { campaignId: string; included: readonly string[] }[]
): SendSample[] {
  const byCampaign = new Map(audiences.map((a) => [a.campaignId, a.included]))
  return sent.map((e) => ({
    sentAt: e.sentAt,
    strategy: e.strategy,
    recipients: e.recipients,
    opens: e.opens,
    clicks: e.clicks,
    machineOpens: null,
    audienceIds: e.campaignId ? (byCampaign.get(e.campaignId) ?? []) : []
  }))
}

// ------------------------------------------------- for "Plan next 15 days"

const hhmm = (hour: number) => `${String(hour).padStart(2, '0')}:00`

/** How sure a best hour is (features/strategy/send-times.ts). */
export function strengthOf(e: SendTimeEntry): TimeStrength {
  if (e.bestHour === null) return 'none'
  if (e.compared) return 'clear'
  return e.rivals > 0 ? 'close' : 'only'
}

/**
 * Each audience's send time: its own best hour when it has enough history;
 * else the store's best hour; else the store's usual hour (`usual`, already
 * inside the send hours); else `fallback`. Null when nothing was counted
 * yet (`entries` null, or no store row): the planner then leaves the times
 * as they are and says nothing about them.
 */
export function resolveSendTimes(
  audienceIds: readonly string[],
  entries: readonly SendTimeEntry[] | null,
  usual: string | null,
  fallback: string
): PlanSendTime[] | null {
  const byId = new Map((entries ?? []).map((e) => [e.audienceId, e]))
  const store = byId.get(storeWide)
  if (!store) return null
  return audienceIds.map((audienceId) => {
    const own = byId.get(audienceId)
    if (own?.bestHour != null)
      return {
        audienceId,
        time: hhmm(own.bestHour),
        basis: 'segment' as const,
        strength: strengthOf(own),
        othersTried: own.facts.hours.length > 1,
        weekday: own.bestWeekday
      }
    if (store.bestHour != null)
      return {
        audienceId,
        time: hhmm(store.bestHour),
        basis: 'store' as const,
        strength: strengthOf(store),
        othersTried: store.facts.hours.length > 1,
        // The store's weekday is never said to be this audience's.
        weekday: null
      }
    return {
      audienceId,
      time: usual ?? fallback,
      basis: usual ? ('usual' as const) : ('default' as const),
      strength: 'none' as const,
      othersTried: false,
      weekday: null
    }
  })
}
