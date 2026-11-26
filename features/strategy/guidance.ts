import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { goalProgress } from '@/features/goals/progress'
import { readRevenueGoals } from '@/features/goals/revenue-goal'
import { localDate } from '@/features/holidays/entries'
import { summaryWindowDays } from '@/features/inbox/brand-summary'
import { offerTracker } from '@/features/inbox/offer-tracker'
import { sendTimeMap } from '@/features/inbox/send-times'
import { emailMix } from '@/features/results/mix'
import {
  resultsReadModel,
  type ResultLine
} from '@/features/results/read-model'
import { developmentPolicy } from '@/features/workflow/domain/policy'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/supabase/database.types'
import type { PlanGuidance } from './plan'
import { addDays, pulseDays } from './pulse'

type Db = SupabaseClient<Database>

/**
 * PICK-WIRE: what "Plan next 15 days" works toward and from, read for the
 * plan step with the worker's client, for the workspace of the claimed run
 * only. Each part is read on its own and left out when it cannot be read,
 * so a plan is never stopped for want of it (logged by code only):
 * - #33: the owner's revenue goal for each month the 15 days touch
 *   (`readRevenueGoals`), worked back to emails from the brand's Results
 *   lines (`goalProgress`), in the store's currency and timezone;
 * - #37: the brand's mix of offer, story, education and product emails
 *   (`emailMix`), with no more offers than the plan's rules allow;
 * - #48, #49: when and how often the brands the workspace follows send
 *   (`sendTimeMap`) and how often they discount (`offerTracker`), as dated
 *   facts (never their codes).
 */

/** Results lines read: the newest, as many as the read allows. */
const linesRead = 200
/** Followed brands the plan names, at most. */
const brandsNamed = 5
/** Weeks of competitor offers the plan looks back over. */
const offerWeeks = 4
/** Emails read per followed brand (far more than 90 days hold). */
const emailsPerBrand = 1000

const monthOf = (day: string) => `${day.slice(0, 7)}-01`
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric'
  }).format(new Date(`${month}T00:00:00Z`))
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(new Date(`${day}T00:00:00Z`))
const cut = (text: string, max: number) =>
  Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, max).join('')
const warn = (part: string) => (error: unknown) => {
  logger.warn('Plan guidance part not read', {
    part,
    code: String((error as { code?: unknown })?.code ?? 'unknown')
  })
  return null
}

/**
 * How many offer emails the plan's rules can hold in 15 days: at most the
 * offer share of a week's emails (whole emails) over about two weeks, and
 * at most one per spacing; none without an offer to run.
 */
export function offersThatFit(sendsPerWeek: number, offers: number) {
  if (offers <= 0) return 0
  const perWeek = Math.floor(
    (sendsPerWeek * developmentPolicy.discountCapPercent) / 100
  )
  const spaced =
    Math.floor((pulseDays - 1) / developmentPolicy.sitewideSpacingDays) + 1
  return Math.min(perWeek * 2, spaced)
}

/** The goals of the months the 15 days touch, worked back to emails. */
export function goalGuidance(input: {
  goals: {
    month: string
    goal: { month: string; amount: number; currency: string } | null
  }[]
  lines: readonly ResultLine[]
  /** The lines are the newest `linesRead`: they may not reach back far enough. */
  capped: boolean
  today: string
  timezone: string
  currency: string | null
  sendsPerWeek: number
}): NonNullable<PlanGuidance['goals']> {
  const sent = input.lines
    .flatMap((l) => (l.sentAt ? [l.sentAt.slice(0, 10)] : []))
    .sort()
  const coversFrom = input.capped && sent[0] ? sent[0] : undefined
  return input.goals.flatMap(({ month, goal }) => {
    if (!goal) return []
    const progress = goalProgress({
      goal,
      lines: input.lines,
      today: input.today,
      timezone: input.timezone,
      storeCurrency: input.currency,
      sendsPerWeek: input.sendsPerWeek,
      ...(coversFrom ? { coversFrom } : {})
    })
    return progress
      ? [
          {
            month,
            label: monthLabel(month),
            sentence: cut(progress.sentence, 400),
            emailsNeeded: progress.emailsNeeded,
            emailsPossible: Math.min(100, progress.emailsPossible),
            needsStrongerEmails: progress.needsStrongerEmails,
            pace: progress.pace
          }
        ]
      : []
  })
}

type FollowedBrand = {
  label: string
  rows: readonly { facts: unknown }[]
}

/**
 * The followed brands' timing and offers as dated facts: per brand, how
 * often it sent in the last 90 days and its usual day and hour (in the
 * store's time), and in how many of the last 4 weeks it ran an offer and
 * its usual percent off. Codes are never named.
 */
export function competitorFacts(
  brands: readonly FollowedBrand[],
  { now, timezone }: { now: number; timezone: string }
): NonNullable<PlanGuidance['competitors']> {
  let today: string
  try {
    today = localDate(timezone, new Date(now))
  } catch {
    return []
  }
  const named = brands.slice(0, brandsNamed)
  const times: { id: string; fact: string }[] = []
  const offers: { id: string; fact: string }[] = []
  named.forEach((b, i) => {
    const label = cut(b.label, 60) || 'A brand you follow'
    const map = sendTimeMap(b.rows, { now, timezone })
    if (map && map.emails > 0) {
      const usual = map.usual[0]
      times.push({
        id: `competitor-times:${i}`,
        fact: cut(
          `${label} sent ${map.emails} ${map.emails === 1 ? 'email' : 'emails'} in the ${map.windowDays} days to ${dayLabel(today)}, about ${map.perWeek} a week${usual ? `, most often on ${usual.day} around ${String(usual.hour).padStart(2, '0')}:00 your store’s time` : ''}.`,
          400
        )
      })
    }
  })
  const tracker = offerTracker(
    named.map((b, i) => ({ domain: String(i), label: b.label, rows: b.rows })),
    { now, timezone, weeks: offerWeeks }
  )
  for (const brand of tracker?.brands ?? []) {
    if (brand.offerWeeks === null) continue
    const weeks = Math.round(brand.offerWeeks * tracker!.weeks.length)
    const label = cut(brand.label, 60) || 'A brand you follow'
    offers.push({
      id: `competitor-offers:${brand.domain}`,
      fact: cut(
        `${label} ran an offer in ${weeks} of the ${tracker!.weeks.length} weeks from ${dayLabel(tracker!.weeks[0]!)} to ${dayLabel(today)}${weeks && brand.usualPercent !== null ? `, usually up to ${brand.usualPercent}% off` : ''}.`,
        400
      )
    })
  }
  return [...times, ...offers].slice(0, 12)
}

/** The store's currency as its catalog read found it, else null. */
async function storeCurrency(db: Db, tenantId: string) {
  const { data, error } = await db
    .from('catalog_status')
    .select('currency')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw error
  const c = data?.currency
  return typeof c === 'string' && /^[A-Z]{3}$/.test(c) ? c : null
}

/** The brands the workspace follows, with their emails' stored facts. */
async function followedBrands(
  db: Db,
  tenantId: string,
  now: number
): Promise<FollowedBrand[]> {
  const subs = await db
    .from('competitor_subscriptions')
    .select('capture_id,label')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('label')
    .limit(brandsNamed)
  if (subs.error) throw subs.error
  const since = new Date(now - summaryWindowDays * 86_400_000).toISOString()
  return Promise.all(
    (subs.data ?? []).map(async (s) => {
      const read = await db
        .from('competitor_emails')
        .select('facts')
        .eq('capture_id', s.capture_id)
        .not('facts', 'is', null)
        .gte('received_at', since)
        .order('received_at', { ascending: false })
        .limit(emailsPerBrand)
      if (read.error) throw read.error
      return { label: s.label, rows: read.data ?? [] }
    })
  )
}

/** The plan's guidance for one workspace's 15 days; never throws. */
export async function planGuidance(
  db: Db,
  input: {
    tenantId: string
    start: string
    timezone: string
    sendsPerWeek: number
    /** How many of the owner's offers the plan may use. */
    offers: number
    now: number
  }
): Promise<PlanGuidance> {
  const { tenantId, timezone, now } = input
  let today: string
  try {
    today = localDate(timezone, new Date(now))
  } catch {
    today = localDate('UTC', new Date(now))
  }
  const months = [
    ...new Set([
      monthOf(input.start),
      monthOf(addDays(input.start, pulseDays - 1))
    ])
  ]
  const [lines, goals, currency, brands] = await Promise.all([
    resultsReadModel(db, tenantId, linesRead).catch(warn('results')),
    readRevenueGoals(db, tenantId, months).catch(warn('goals')),
    storeCurrency(db, tenantId).catch(warn('currency')),
    followedBrands(db, tenantId, now).catch(warn('competitors'))
  ])
  const guidance: PlanGuidance = {}
  if (lines && goals) {
    const g = goalGuidance({
      goals,
      lines,
      capped: lines.length >= linesRead,
      today,
      timezone,
      currency,
      sendsPerWeek: input.sendsPerWeek
    })
    if (g.length) guidance.goals = g
  }
  if (lines) {
    const mix = emailMix(lines, {
      emails: Math.round((input.sendsPerWeek * pulseDays) / 7),
      maxOffers: offersThatFit(input.sendsPerWeek, input.offers)
    })
    guidance.mix = { counts: mix.counts, basis: mix.basis }
  }
  if (brands) {
    const facts = competitorFacts(brands, { now, timezone })
    if (facts.length) guidance.competitors = facts
  }
  return guidance
}
