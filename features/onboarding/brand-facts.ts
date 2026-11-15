import type { z } from 'zod'
import type { BrandFacts } from '@/features/copy-qa/check'
import {
  topicValues,
  type Finding,
  type FindingSource
} from '@/features/onboarding/findings'

/**
 * The brand's true facts from what the onboarding readers found (ONB-106a,
 * D19): free shipping, returns, money-back guarantee, delivery time and
 * whether its reviews are real. When sources (or two pages of one source)
 * disagree, the stricter fact is used and the conflict recorded: the less
 * generous promise is true under every source, the other is never stated.
 *
 * Stricter means: no free shipping before free shipping over an amount,
 * a higher amount before a lower one, both before always; fewer days to
 * return or for the guarantee; the slower delivery window. Only findings at
 * least `minConfidence` sure count, and a sample-rules finding never counts
 * for a live workspace. Pure: the Brand strategist (ONB-106) writes these
 * into the Brand book and the email build's store source (ONB-057b) hands
 * them to copy QA (`copyFacts`).
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
  /** What each source said, in its own plain sentence. */
  said: { source: FindingSource; statement: string }[]
}

export type TrueFacts = {
  freeShipping: FreeShipping | null
  /** Days a customer has to return; 0 means no returns. */
  returnDays: number | null
  /** Money-back guarantee in days; 0 means none. */
  guaranteeDays: number | null
  deliveryDays: { min: number; max: number } | null
  /** True only when a review platform the brand uses is verified. */
  reviewsVerified: boolean
  conflicts: FactConflict[]
}

type Sure<T extends FactTopic> = { finding: Finding; value: Value<T> }

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

/** Lower is stricter. Amounts in other currencies cannot be compared. */
function shippingRank(v: FreeShipping, currency: string | null) {
  if (v.kind === 'never') return -Infinity
  if (v.kind === 'always') return Infinity
  if (currency && v.currency !== currency) return null
  return -v.amount
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The stricter of each fact, and the conflicts. `currency` is the store's
 * (an "over" amount in another one is not used).
 */
export function trueFacts(
  findings: readonly Finding[],
  {
    live = false,
    currency = null
  }: { live?: boolean; currency?: string | null } = {}
): TrueFacts {
  const conflicts: FactConflict[] = []
  function pick<T extends FactTopic>(
    topic: T,
    stricter: (a: Value<T>, b: Value<T>) => Value<T> | null
  ): Value<T> | null {
    const all = sure(findings, topic, live) as Sure<T>[]
    if (!all.length) return null
    let chosen: Value<T> | null = all[0]!.value
    for (const s of all.slice(1))
      chosen = chosen === null ? null : stricter(chosen, s.value)
    const differ = all.some((s) => !same(s.value, all[0]!.value))
    if (differ)
      conflicts.push({
        topic,
        said: all.map((s) => ({
          source: s.finding.source,
          statement: s.finding.statement
        }))
      })
    return chosen
  }
  const freeShipping = pick('free_shipping', (a, b) => {
    // Two amounts we cannot compare: say nothing about free shipping.
    if (a.kind === 'over' && b.kind === 'over' && a.currency !== b.currency)
      return null
    const ra = shippingRank(a, currency)
    const rb = shippingRank(b, currency)
    if (ra === null || rb === null) return null
    return rb < ra ? b : a
  })
  const returns = pick('returns', (a, b) => (b.days < a.days ? b : a))
  const guarantee = pick('guarantee', (a, b) => (b.days < a.days ? b : a))
  const delivery = pick('delivery_days', (a, b) => ({
    min: Math.max(a.min, b.min),
    max: Math.max(a.max, b.max)
  }))
  const reviewsVerified = sure(findings, 'review_platform', live).some(
    (s) => s.finding.source === 'reviews' && s.value.verified
  )
  return {
    freeShipping:
      freeShipping?.kind === 'over' &&
      currency &&
      freeShipping.currency !== currency
        ? null
        : freeShipping,
    returnDays: returns?.days ?? null,
    guaranteeDays: guarantee?.days ?? null,
    deliveryDays: delivery ? { min: delivery.min, max: delivery.max } : null,
    reviewsVerified,
    conflicts
  }
}

/**
 * The facts copy QA and the writer use. Anything unknown stays null, so a
 * claim about it is refused. `approvedClaims` and `bannedPhrases` come
 * from the brand (and ONB-062's industry list via `withClaimsSafety`).
 */
export function copyFacts(
  facts: TrueFacts,
  {
    approvedClaims = [],
    bannedPhrases = []
  }: { approvedClaims?: string[]; bannedPhrases?: string[] } = {}
): BrandFacts {
  const shipping = facts.freeShipping
  return {
    freeShipping:
      shipping === null
        ? null
        : shipping.kind === 'over'
          ? { over: shipping.amount }
          : shipping.kind,
    deliveryDays: facts.deliveryDays,
    returnDays: facts.returnDays,
    guaranteeDays: facts.guaranteeDays,
    approvedClaims,
    bannedPhrases,
    reviewsVerified: facts.reviewsVerified
  }
}
