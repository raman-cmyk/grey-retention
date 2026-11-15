import type { z } from 'zod'
import type { BrandFacts } from '@/features/copy-qa/check'
import {
  topicValues,
  type Finding,
  type FindingSource,
  type SitePageKind
} from '@/features/onboarding/findings'

/**
 * The brand's true facts from what the onboarding readers found (ONB-106a,
 * D19): free shipping, returns, money-back guarantee, delivery time and
 * whether its reviews are real. Two views:
 *
 * - `trueFacts`, for the Brand book: per topic the stricter of what the
 *   sources say (free shipping never, then over a higher amount, then
 *   always; fewer days; the slower delivery window per region), with every
 *   conflict and which page said what, so the owner can correct it.
 * - `copyFacts`, for copy QA and the writer: only what is true under every
 *   source. A stricter positive fact is (an order over $100 is also over
 *   $75; 14 days is within 30), so it is kept. A negative one ("No
 *   returns.", "There is no free shipping.") is not, when another source
 *   says otherwise or it did not come from the policy page itself (a
 *   product page's "final sale" is about some items): then the topic is
 *   unknown and copy QA refuses every claim about it.
 *
 * Only findings at least `minConfidence` sure count, never a sample-rules
 * finding for a live workspace. Ads never set the standing free shipping:
 * an ad's "free shipping this weekend" is a dated offer for the plan. Only
 * a money-back guarantee counts as one, never a warranty against defects.
 */

export const minConfidence = 0.6

type Value<T extends keyof typeof topicValues> = z.infer<
  (typeof topicValues)[T]
>
export type FreeShipping = Value<'free_shipping'>
export type FactTopic =
  'free_shipping' | 'returns' | 'guarantee' | 'delivery_days'

export type FactConflict = {
  topic: FactTopic
  /**
   * `disagree`: sources say different things; `other_currency`: an amount
   * in another currency than the store's; `unknown_currency`: an amount
   * while the store's currency is not known.
   */
  reason: 'disagree' | 'other_currency' | 'unknown_currency'
  /** What each source said, in its own plain sentence, and where. */
  said: {
    source: FindingSource
    statement: string
    url: string | null
    page: SitePageKind | null
  }[]
}

/** A fact for the Brand book: the stricter value, and how sure copy may be of it. */
export type Fact<T> = {
  value: T
  /** Sources said different things. */
  conflict: boolean
  /** A finding with this value came from the topic's own policy page. */
  fromPolicyPage: boolean
}

export type DeliveryWindow = {
  /** Null for a window with no region named. */
  region: string | null
  min: number
  max: number
  /** The page counted business days, not calendar days. */
  businessDays: boolean
  conflict: boolean
}

export type TrueFacts = {
  freeShipping: Fact<FreeShipping> | null
  /** Days a customer has to return; 0 means no returns. */
  returnDays: Fact<number> | null
  /** Money-back guarantee in days; 0 means none. */
  guaranteeDays: Fact<number> | null
  /** One window per region named (null: no region). */
  delivery: DeliveryWindow[]
  /** True only when a review platform the brand uses is verified. */
  reviewsVerified: boolean
  conflicts: FactConflict[]
}

/** The pages each topic's policy lives on. */
const policyPages: Record<FactTopic, readonly SitePageKind[]> = {
  free_shipping: ['shipping'],
  returns: ['returns'],
  guarantee: ['returns', 'faq'],
  delivery_days: ['shipping']
}

/** A money-back guarantee in the page's own words (never the reader's). */
const moneyBack =
  /money[- ]back|satisfaction guarantee|your money back|risk[- ]free/i
/** A warranty or a repair, never a money-back guarantee. */
const warranty = /defect|faulty|repair|replac|warrant/i
/** A dated offer, never the standing policy ("this weekend only"). */
const datedOffer =
  /\b(?:today|tonight|this (?:week|weekend|month)|weekend|only|ends?|until|limited|first order|code|sale|black friday|cyber|holiday)\b/i
/** The site reader counts business days unless the page says calendar days. */
const calendarDays = /\bcalendar\s+days?\b/i
const quoteOf = (f: Finding) => ('quote' in f.evidence ? f.evidence.quote : '')

type Sure<T extends FactTopic> = { finding: Finding; value: Value<T> }

const pageOf = (f: Finding) =>
  'page' in f.evidence ? (f.evidence.page ?? null) : null
const urlOf = (f: Finding) => ('url' in f.evidence ? f.evidence.url : null)
const said = (all: readonly { finding: Finding }[]) =>
  all.map(({ finding: f }) => ({
    source: f.source,
    statement: f.statement,
    url: urlOf(f),
    page: pageOf(f)
  }))

/** The sure findings of a topic whose value fits it. */
function sure<T extends FactTopic | 'review_platform'>(
  findings: readonly Finding[],
  topic: T,
  live: boolean
) {
  return findings.flatMap((f) => {
    if (f.topic !== topic || f.confidence < minConfidence) return []
    if (live && f.pass === 'sample') return []
    const value = topicValues[topic].safeParse(f.value)
    return value.success ? [{ finding: f, value: value.data as Value<T> }] : []
  })
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The stricter of each fact, every conflict and where each came from.
 * `currency` is the store's (null when unknown: then no "over" amount is
 * used, as its currency cannot be checked).
 */
export function trueFacts(
  findings: readonly Finding[],
  { live, currency }: { live: boolean; currency: string | null }
): TrueFacts {
  const conflicts: FactConflict[] = []
  const fact = <T extends FactTopic, V>(
    topic: T,
    all: Sure<T>[],
    value: V,
    of: (v: Value<T>) => V
  ): Fact<V> => {
    const conflict = all.some((s) => !same(s.value, all[0]!.value))
    if (conflict) conflicts.push({ topic, reason: 'disagree', said: said(all) })
    return {
      value,
      conflict,
      fromPolicyPage: all.some(
        (s) =>
          same(of(s.value), value) &&
          policyPages[topic].includes(pageOf(s.finding) as SitePageKind)
      )
    }
  }

  // Free shipping: the site's standing policy, never an ad's offer.
  const store = currency?.trim().toUpperCase() || null
  // A site-wide footer line is credited to the home page, so a positive
  // free shipping counts from any page; a dated offer never does.
  const shipping = sure(findings, 'free_shipping', live).filter(
    (s) => s.finding.source !== 'ads' && !datedOffer.test(quoteOf(s.finding))
  )
  const foreign = shipping.filter(
    (s) => s.value.kind === 'over' && s.value.currency !== store
  )
  if (foreign.length)
    conflicts.push({
      topic: 'free_shipping',
      reason: store ? 'other_currency' : 'unknown_currency',
      said: said(foreign)
    })
  let freeShipping: Fact<FreeShipping> | null = null
  if (shipping.length) {
    const never = shipping.find((s) => s.value.kind === 'never')
    const overs = shipping.flatMap((s) =>
      s.value.kind === 'over' ? [s.value] : []
    )
    // Never is the strictest whatever else is said; an amount in another
    // currency (or with the store's unknown) makes free shipping unknown.
    const value: FreeShipping | null = never
      ? never.value
      : foreign.length
        ? null
        : overs.length
          ? overs.reduce((a, b) => (b.amount > a.amount ? b : a))
          : { kind: 'always' }
    freeShipping =
      value === null ? null : fact('free_shipping', shipping, value, (v) => v)
  }

  const days = (topic: 'returns' | 'guarantee', all: Sure<typeof topic>[]) =>
    all.length
      ? fact(
          topic,
          all,
          Math.min(...all.map((s) => s.value.days)),
          (v) => v.days
        )
      : null
  const returnDays = days('returns', sure(findings, 'returns', live))
  // Only a money-back guarantee, in the page's own words, never a
  // warranty against defects.
  const guaranteeDays = days(
    'guarantee',
    sure(findings, 'guarantee', live).filter(
      (s) =>
        moneyBack.test(quoteOf(s.finding)) && !warranty.test(quoteOf(s.finding))
    )
  )

  // Delivery: per region, the slower window; windows of two regions are
  // not a conflict.
  const byRegion = new Map<string | null, Sure<'delivery_days'>[]>()
  for (const s of sure(findings, 'delivery_days', live)) {
    const region = s.value.region?.trim().toLowerCase() || null
    byRegion.set(region, [...(byRegion.get(region) ?? []), s])
  }
  const delivery = [...byRegion.values()].map((all) => {
    const window = (s: Sure<'delivery_days'>) => ({
      min: s.value.min,
      max: s.value.max
    })
    const conflict = all.some((s) => !same(window(s), window(all[0]!)))
    if (conflict)
      conflicts.push({
        topic: 'delivery_days',
        reason: 'disagree',
        said: said(all)
      })
    return {
      region: all[0]!.value.region ?? null,
      min: Math.max(...all.map((s) => s.value.min)),
      max: Math.max(...all.map((s) => s.value.max)),
      businessDays: !all.every((s) => calendarDays.test(quoteOf(s.finding))),
      conflict
    }
  })

  const reviewsVerified = sure(findings, 'review_platform', live).some(
    (s) => s.finding.source === 'reviews' && s.value.verified
  )
  return {
    freeShipping,
    returnDays,
    guaranteeDays,
    delivery,
    reviewsVerified,
    conflicts
  }
}

/** A negative fact copy may state: unconflicted and from the policy page. */
const negativeOk = (f: Fact<unknown>) => !f.conflict && f.fromPolicyPage

/** Business days as calendar days at most: five a week, weekends added. */
const calendar = (w: DeliveryWindow) =>
  w.businessDays
    ? { min: w.min, max: Math.ceil(w.max / 5) * 7 }
    : { min: w.min, max: w.max }

/**
 * The facts copy QA and the writer use: only what is true under every
 * source. Anything unknown stays null, so a claim about it is refused.
 * `approvedClaims` and `bannedPhrases` come from the brand (and ONB-062's
 * industry list via `withClaimsSafety`).
 */
export function copyFacts(
  facts: TrueFacts,
  {
    approvedClaims = [],
    bannedPhrases = []
  }: { approvedClaims?: string[]; bannedPhrases?: string[] } = {}
): BrandFacts {
  // A dated offer never got here; "no free shipping" needs the shipping page.
  const shipping = facts.freeShipping
  const freeShipping: BrandFacts['freeShipping'] =
    shipping === null
      ? null
      : shipping.value.kind === 'never'
        ? negativeOk(shipping)
          ? 'never'
          : null
        : shipping.value.kind === 'over'
          ? { over: shipping.value.amount }
          : 'always'
  const days = (f: Fact<number> | null) =>
    f === null ? null : f.value === 0 && !negativeOk(f) ? null : f.value
  // A window for everyone, never faster than the slowest region: copy QA
  // allows no promise faster than the slowest confirmed case.
  const everyone = facts.delivery.find((w) => w.region === null)
  const deliveryDays = everyone
    ? {
        min: calendar(everyone).min,
        max: Math.max(...facts.delivery.map((w) => calendar(w).max))
      }
    : null
  return {
    freeShipping,
    deliveryDays,
    returnDays: days(facts.returnDays),
    guaranteeDays: days(facts.guaranteeDays),
    approvedClaims,
    bannedPhrases,
    reviewsVerified: facts.reviewsVerified
  }
}
