import { z } from 'zod'
import { grosSegmentNamePattern } from '@/lib/providers/klaviyo/segment-name'
import type { HygieneMetrics } from '@/lib/providers/klaviyo/segments'
import type {
  LastSeen,
  ProfileFacts,
  ProfileGroup,
  Suppression
} from '@/lib/providers/klaviyo-read'

/**
 * PICK-101 (owner pick #101, "List hygiene"): every email GROS plans
 * leaves out people who bounced or are suppressed, and people who have not
 * engaged for a long time. The rule is data (`HygieneRule`), so a person,
 * the code and the Klaviyo segment all read the same thing. Pure.
 *
 * What it decides:
 * - Bounced or suppressed people are always out (Klaviyo never emails them
 *   either). They are never counted as reachable, and never counted twice.
 * - Someone is unengaged when, in the last `days` (180 by default), they
 *   had no click, no real open, no site visit and no order, after GROS had
 *   a fair chance to see it: they already got emails before that window
 *   and at least `minEmails` emails inside it.
 * - Apple Mail Privacy opens fake an open for nearly every Apple Mail
 *   reader, so an open Klaviyo marks as an Apple privacy open never counts.
 *   Any other open counts (a real reader who never clicks stays in).
 * - Someone who ordered in the last `recentOrderDays` (never shorter than
 *   180) always stays in, whatever else is true.
 * - Unknown is not unengaged: a person whose clicks, opens or emails are
 *   unknown stays in. A store with no site-visit or order data is judged
 *   on what it has (clicks and real opens); that is never a reason to leave
 *   someone out.
 *
 * Turning hygiene off keeps everyone Klaviyo can email; bounced and
 * suppressed people stay out (Klaviyo skips them anyway).
 */

/** The owner's per-store setting (Audiences). */
export type HygieneSettings = { enabled: boolean; days: number }

/** The default: on, 180 days. */
export const hygieneDefaults: HygieneSettings = Object.freeze({
  enabled: true,
  days: 180
})

/** The days the owner may choose (the database checks the same). */
export const hygieneDayBounds = Object.freeze({ min: 30, max: 730 })

/** An order this recent always keeps a person, whatever the owner's days. */
export const recentOrderFloorDays = 180

/**
 * Proposal (owner to confirm): at least this many emails inside the window
 * before someone can be called unengaged. Fewer is too little evidence.
 */
export const minEmailsToJudge = 5

export const hygieneSettingsSchema = z.object({
  enabled: z.boolean(),
  days: z.number().int().min(hygieneDayBounds.min).max(hygieneDayBounds.max)
})

export type HygieneRule = {
  version: 1
  enabled: boolean
  /** No click, real open, site visit or order in this many days: unengaged. */
  days: number
  /** An order in this many days always keeps a person. */
  recentOrderDays: number
  /** At least this many emails inside `days` before anyone is unengaged. */
  minEmails: number
  /** What shows a person is still engaged. */
  engagedBy: readonly EngagementSignal[]
  /** Always left out: Klaviyo will not email them. */
  alwaysOut: readonly Suppression[]
}

export type EngagementSignal = 'click' | 'open' | 'site_visit' | 'order'

export const engagementSignals: readonly EngagementSignal[] = Object.freeze([
  'click',
  'open',
  'site_visit',
  'order'
])

export const suppressions: readonly Suppression[] = Object.freeze([
  'hard_bounce',
  'invalid_email',
  'spam_complaint',
  'unsubscribed',
  'user_suppressed'
])

/** The rule from the owner's setting (invalid settings fall back to the default). */
export function hygieneRule(settings: HygieneSettings = hygieneDefaults) {
  const parsed = hygieneSettingsSchema.safeParse(settings)
  const s = parsed.success ? parsed.data : hygieneDefaults
  return Object.freeze({
    version: 1 as const,
    enabled: s.enabled,
    days: s.days,
    recentOrderDays: Math.max(s.days, recentOrderFloorDays),
    minEmails: minEmailsToJudge,
    engagedBy: engagementSignals,
    alwaysOut: suppressions
  }) satisfies HygieneRule
}

/** Bounced (the address does not work) or another suppression. */
export const bounced = (s: Suppression) =>
  s === 'hard_bounce' || s === 'invalid_email'

export type Verdict =
  | { out: true; why: 'bounced' | 'suppressed' | 'unengaged' }
  | {
      out: false
      why:
        | 'engaged'
        | 'recent_order'
        | 'new'
        | 'few_emails'
        | 'unknown'
        | 'hygiene_off'
    }

const dayMs = 86_400_000

/** Whether `seen` is a time inside the last `days` (a future time counts as now). */
function within(seen: LastSeen, days: number, now: Date) {
  if (seen === 'never' || seen === 'unknown') return false
  const at = Date.parse(seen)
  return Number.isFinite(at) && now.getTime() - at < days * dayMs
}
const unknownOrBad = (seen: LastSeen) =>
  seen === 'unknown' || (seen !== 'never' && !Number.isFinite(Date.parse(seen)))

/** One person (or one group of people sharing these facts). */
export function judge(
  facts: ProfileFacts,
  rule: HygieneRule,
  now: Date
): Verdict {
  if (facts.suppression !== null)
    return {
      out: true,
      why: bounced(facts.suppression) ? 'bounced' : 'suppressed'
    }
  if (!rule.enabled) return { out: false, why: 'hygiene_off' }
  // Never leave out someone who ordered recently.
  if (within(facts.lastOrder, rule.recentOrderDays, now))
    return { out: false, why: 'recent_order' }
  // Any engagement inside the window keeps them. An Apple privacy open is
  // never engagement (`lastPrivacyOpen` is not read).
  if (
    within(facts.lastClick, rule.days, now) ||
    within(facts.lastOpen, rule.days, now) ||
    within(facts.lastSiteVisit, rule.days, now)
  )
    return { out: false, why: 'engaged' }
  // Unknown is not unengaged. Site visits and orders may be missing for a
  // whole store (no tracking): the rule then judges on clicks and opens.
  if (
    unknownOrBad(facts.lastClick) ||
    unknownOrBad(facts.lastOpen) ||
    unknownOrBad(facts.firstEmail) ||
    facts.emails === 'unknown'
  )
    return { out: false, why: 'unknown' }
  // Too new to judge: no email before the window started.
  if (facts.firstEmail === 'never' || within(facts.firstEmail, rule.days, now))
    return { out: false, why: 'new' }
  const inWindow = facts.emails.filter((e) => within(e, rule.days, now)).length
  if (inWindow < rule.minEmails) return { out: false, why: 'few_emails' }
  return { out: true, why: 'unengaged' }
}

export type HygieneCounts = {
  /** Everyone counted. */
  total: number
  /** People an email can reach after hygiene: never anyone suppressed. */
  reachable: number
  /** bounced + suppressed + unengaged; each person counted once. */
  leftOut: number
  bounced: number
  /** Unsubscribed, spam complaints and other suppressions (not bounces). */
  suppressed: number
  unengaged: number
  /** Kept because their data is unknown or too thin to judge. */
  keptUnsure: number
  /** Kept by a recent order alone. */
  keptRecentOrder: number
}

const safeCount = (n: number) =>
  Number.isInteger(n) && n > 0 && n <= 1e12 ? n : 0

/** Counts people (grouped) under the rule. */
export function countHygiene(
  groups: readonly ProfileGroup[],
  rule: HygieneRule,
  now: Date
): HygieneCounts {
  const c: HygieneCounts = {
    total: 0,
    reachable: 0,
    leftOut: 0,
    bounced: 0,
    suppressed: 0,
    unengaged: 0,
    keptUnsure: 0,
    keptRecentOrder: 0
  }
  for (const group of groups) {
    const n = safeCount(group.count)
    if (!n) continue
    c.total += n
    const v = judge(group.facts, rule, now)
    if (v.out) {
      c.leftOut += n
      c[v.why] += n
      continue
    }
    c.reachable += n
    if (v.why === 'recent_order') c.keptRecentOrder += n
    if (v.why === 'unknown' || v.why === 'few_emails' || v.why === 'new')
      c.keptUnsure += n
  }
  return c
}

const number = (n: number) => new Intl.NumberFormat('en-US').format(n)
const peopleWords = (n: number) =>
  n === 1 ? '1 person' : `${number(n)} people`

/** What counts as engagement, in the owner's words. */
export const engagedWords = 'clicks, site visits or orders'

/**
 * The plain sentence: "1,240 people left out: 310 bounced, 930 with no
 * clicks, site visits or orders in 180 days". With hygiene off it says
 * only who Klaviyo skips.
 */
export function hygieneCountWords(counts: HygieneCounts, rule: HygieneRule) {
  const parts = [
    counts.bounced ? `${number(counts.bounced)} bounced` : '',
    counts.suppressed
      ? `${number(counts.suppressed)} unsubscribed or blocked`
      : '',
    counts.unengaged
      ? `${number(counts.unengaged)} with no ${engagedWords} in ${rule.days} days`
      : ''
  ].filter(Boolean)
  if (!counts.leftOut) return 'Nobody is left out.'
  return `${peopleWords(counts.leftOut)} left out: ${parts.join(', ')}`
}

/** The rule in plain words, one short line each (beside the setting). */
export function hygieneRuleLines(rule: HygieneRule) {
  if (!rule.enabled)
    return [
      'Off: GROS plans for everyone Klaviyo can email.',
      'Klaviyo still skips people who bounced or are suppressed.'
    ]
  return [
    `Left out: people who bounced or are suppressed, and people with no ${engagedWords} in ${rule.days} days.`,
    `Always kept: anyone who ordered in the last ${rule.recentOrderDays} days, and anyone too new to judge.`,
    'Apple Mail privacy opens do not count as opens.'
  ]
}

// --- The Klaviyo segment GROS keeps for this rule -------------------------

/** The Klaviyo metrics the segment reads (their ids in this account). */
export type { HygieneMetrics }

/**
 * The Opened Email property Klaviyo sets on Apple privacy (machine) opens.
 * To prove on the first live account (revision 2026-10-15 does not
 * document its name in the segments API).
 */
export const privacyOpenProperty = 'Apple Privacy Open'

/** The segment's name in Klaviyo: one per rule (a new `days` is a new segment). */
export const hygieneSegmentName = (rule: HygieneRule) =>
  `GROS list hygiene · ${rule.days} days · v${rule.version}`

/** Only names GROS makes for this rule (the Klaviyo client checks it too). */
export const hygieneSegmentNamePattern = grosSegmentNamePattern

/** The rule's key in our database (`klaviyo_hygiene_segments.rule_key`). */
export const hygieneRuleKey = (rule: HygieneRule) =>
  `v${rule.version}-${rule.days}`

const metricCount = (
  metricId: string,
  operator: 'equals' | 'greater-than-or-equal',
  value: number,
  timeframe: Record<string, unknown>,
  metricFilters: unknown[] | null = null
) => ({
  type: 'profile-metric',
  metric_id: metricId,
  measurement: 'count',
  measurement_filter: { type: 'numeric', operator, value },
  timeframe_filter: timeframe,
  metric_filters: metricFilters
})
const inTheLast = (days: number) => ({
  type: 'date',
  operator: 'in-the-last',
  quantity: days,
  unit: 'day'
})
const before = (days: number) => ({
  type: 'date',
  operator: 'before',
  quantity: days,
  unit: 'day'
})

/**
 * The people the rule leaves out as unengaged, as a Klaviyo segment
 * definition (condition groups must all hold). Bounced and suppressed
 * people need no segment: Klaviyo never emails them. Null when the account
 * lacks a metric the rule needs to judge anyone (Received, Clicked or
 * Opened Email): then nobody is left out as unengaged.
 */
export function hygieneSegmentDefinition(
  rule: HygieneRule,
  metrics: HygieneMetrics
) {
  if (!rule.enabled) return null
  const { receivedEmail, clickedEmail, openedEmail } = metrics
  if (!receivedEmail || !clickedEmail || !openedEmail) return null
  const group = (condition: Record<string, unknown>) => ({
    conditions: [condition]
  })
  const groups = [
    // Already getting emails before the window: not too new to judge.
    group(
      metricCount(receivedEmail, 'greater-than-or-equal', 1, before(rule.days))
    ),
    // Enough emails inside the window to judge.
    group(
      metricCount(
        receivedEmail,
        'greater-than-or-equal',
        rule.minEmails,
        inTheLast(rule.days)
      )
    ),
    group(metricCount(clickedEmail, 'equals', 0, inTheLast(rule.days))),
    // Real opens only: Apple privacy opens are left out of the count.
    group(
      metricCount(openedEmail, 'equals', 0, inTheLast(rule.days), [
        {
          property: privacyOpenProperty,
          filter: { type: 'boolean', operator: 'equals', value: false }
        }
      ])
    ),
    ...(metrics.activeOnSite
      ? [
          group(
            metricCount(metrics.activeOnSite, 'equals', 0, inTheLast(rule.days))
          )
        ]
      : []),
    ...(metrics.placedOrder
      ? [
          group(
            metricCount(
              metrics.placedOrder,
              'equals',
              0,
              inTheLast(rule.recentOrderDays)
            )
          )
        ]
      : [])
  ]
  return { condition_groups: groups }
}
