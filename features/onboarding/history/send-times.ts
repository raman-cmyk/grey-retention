import { z } from 'zod'
import type { PlanSendTime } from '@/features/strategy/send-times'
import { minRecipients, sendParts, type SentEmail } from './facts'

/**
 * PICK-97 (owner pick #97, "Best send time per segment"): from what the
 * store already sent with Klaviyo, the hours and weekdays when each list or
 * segment's people open and click most, in the store's timezone. Counted
 * in code from the campaign report (one row per sent email: recipients,
 * unique opens, unique clicks) and each campaign's audiences; no extra
 * Klaviyo report is asked.
 *
 * Facts (counts per hour and weekday, first and last send) are kept apart
 * from the recommendation (the best hour, the best weekday, and why there
 * is none). A recommendation needs enough history: `minSends` counted sends
 * to the audience, and an hour (or weekday) it got at least `minSlotSends`
 * times. Otherwise it says "not enough history" (`reason`), and the planner
 * falls back to the store-wide best hour, then the store's usual hour,
 * then a default (`resolveSendTimes`).
 *
 * Opens are inflated by Apple Mail Privacy Protection (machine opens fire
 * when the mail is delivered, whoever reads it), so a click counts as
 * `clickWeight` opens, and opens a source flags as machine opens
 * (`machineOpens`) are taken off. Klaviyo's campaign report does not flag
 * them today: the field stays null and clicks carry the weight.
 */

export const sendTimeRules = {
  /** Counted sends an audience needs before it gets its own time. */
  minSends: 3,
  /** Sends an hour (or weekday) needs before it can be the best one. */
  minSlotSends: 2,
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

/** The whole store's row (every send, whatever its audience). */
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
  /** The lists and segments it went to (Klaviyo ids). */
  audienceIds: readonly string[]
}

const count = z.number().int().nonnegative().max(1_000_000_000)
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

/** What was counted: the facts, never a recommendation. */
export const sendTimeFacts = z.strictObject({
  /** Sends counted (one time for everyone or each person's own clock). */
  sends: z.number().int().min(0).max(300),
  /**
   * Sends to it not counted: Klaviyo picked the time per person, too few
   * recipients, no results read, or still collecting opens.
   */
  leftOut: z.number().int().min(0).max(300),
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
  'no_repeated_time'
] as const

/** One audience's (or the store's) facts and recommendation. */
export const sendTimeEntry = z
  .strictObject({
    audienceId: z.string().regex(/^(\*|[A-Za-z0-9]{1,64})$/),
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
    /** The best hour beat at least one other hour that was tried enough. */
    compared: z.boolean(),
    reason: z.enum(sendTimeReasons)
  })
  .refine((e) => (e.reason === 'enough') === (e.bestHour !== null))
  .refine((e) => e.bestHour !== null || !e.compared)
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

/** The best slot among those tried enough, or null. */
function best<K extends string | number>(
  slots: Map<K, Tally>,
  allowed: (key: K) => boolean,
  order: (a: K, b: K) => number
) {
  const eligible = [...slots.entries()].filter(
    ([k, t]) => t.sends >= sendTimeRules.minSlotSends && allowed(k)
  )
  eligible.sort(
    ([ka, a], [kb, b]) =>
      engagement(b) - engagement(a) ||
      b.clicks / Math.max(1, b.recipients) -
        a.clicks / Math.max(1, a.recipients) ||
      b.sends - a.sends ||
      order(ka, kb)
  )
  return { key: eligible[0]?.[0] ?? null, eligible: eligible.length }
}

/** The local hour and weekday of a send; null for a time Klaviyo picked per person. */
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
  sends: readonly (Counted | null)[],
  iso: (at: number) => string
): SendTimeEntry {
  const kept = sends.filter((s): s is Counted => s !== null)
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
    leftOut: sends.length - kept.length,
    firstSentAt: times.length ? iso(Math.min(...times)) : null,
    lastSentAt: times.length ? iso(Math.max(...times)) : null,
    ...total,
    hours: [...hours.entries()]
      .sort(([a], [b]) => a - b)
      .map(([hour, t]) => ({ hour, ...t })),
    weekdays: weekdays.flatMap((weekday) => {
      const t = days.get(weekday)
      return t ? [{ weekday, ...t }] : []
    })
  }
  if (kept.length < sendTimeRules.minSends)
    return {
      audienceId,
      facts,
      bestHour: null,
      bestWeekday: null,
      compared: false,
      reason: 'few_sends'
    }
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
  return {
    audienceId,
    facts,
    bestHour: hour.key,
    bestWeekday: day.key,
    compared: hour.key !== null && hour.eligible >= 2,
    reason: hour.key === null ? 'no_repeated_time' : 'enough'
  }
}

/**
 * The store's row first (every send), then one per audience that got a
 * send in the history read, most sends first (at most `maxAudiences`).
 * Pure: the same history always gives the same answer.
 */
export function sendTimes(
  samples: readonly SendSample[],
  timezone: string,
  now: number
): SendTimeEntry[] {
  const iso = (at: number) =>
    new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const all = samples.map((s) => counted(s, timezone, now))
  const byAudience = new Map<string, (Counted | null)[]>()
  samples.forEach((s, i) => {
    for (const id of new Set(s.audienceIds)) {
      if (!/^[A-Za-z0-9]{1,64}$/.test(id)) continue
      byAudience.set(id, [...(byAudience.get(id) ?? []), all[i]!])
    }
  })
  const audiences = [...byAudience.entries()]
    .map(([id, sends]) => entry(id, sends, iso))
    .sort(
      (a, b) =>
        b.facts.sends - a.facts.sends ||
        (a.audienceId < b.audienceId ? -1 : a.audienceId > b.audienceId ? 1 : 0)
    )
    .slice(0, maxAudiences)
  return [entry(storeWide, all, iso), ...audiences]
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

/**
 * Each audience's send time: its own best hour when it has enough history;
 * else the store's best hour; else the store's usual hour (`usual`, already
 * inside the send hours); else `fallback`. `entries` is null when none were
 * read.
 */
export function resolveSendTimes(
  audienceIds: readonly string[],
  entries: readonly SendTimeEntry[] | null,
  usual: string | null,
  fallback: string
): PlanSendTime[] {
  const byId = new Map((entries ?? []).map((e) => [e.audienceId, e]))
  const store = byId.get(storeWide)
  return audienceIds.map((audienceId) => {
    const own = byId.get(audienceId)
    if (own?.bestHour != null)
      return {
        audienceId,
        time: hhmm(own.bestHour),
        basis: 'segment' as const,
        compared: own.compared,
        weekday: own.bestWeekday
      }
    if (store?.bestHour != null)
      return {
        audienceId,
        time: hhmm(store.bestHour),
        basis: 'store' as const,
        compared: store.compared,
        weekday: store.bestWeekday
      }
    return {
      audienceId,
      time: usual ?? fallback,
      basis: usual ? ('usual' as const) : ('default' as const),
      compared: false,
      weekday: null
    }
  })
}
