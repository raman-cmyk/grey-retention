import { developmentPolicy } from '@/features/workflow/domain/policy'
import type { EmailType } from '@/features/strategy/plan'
import type { ResultLine } from './read-model'

/**
 * PLN-037 (owner pick #37, D27): a balanced email mix, learned per brand.
 * How many of the next 15 days' emails should be offers, stories,
 * education and product emails. It starts from a default mix and moves,
 * slowly, toward the kinds that earned more per person for this brand,
 * from real sent emails whose results are final. Offers never go above
 * the plan's offer share. The plan step (lane A) uses it as a target.
 */
export const mixKinds = ['offer', 'story', 'education', 'product'] as const
export type MixKind = (typeof mixKinds)[number]

/** Each planned email type's kind; product emails are the rest of `emailTypes`. */
const kindByType = new Map<string, MixKind>(
  Object.entries({
    offer: 'offer',
    story: 'story',
    education: 'education',
    launch: 'product',
    bestseller: 'product',
    'gift guide': 'product',
    restock: 'product',
    reminder: 'product'
  } satisfies Record<EmailType, MixKind>)
)

/** A planned email type's kind (PICK-WIRE: the plan step counts its mix). */
export const mixKindOf = (type: EmailType): MixKind =>
  kindByType.get(type) ?? 'product'

/** The mix before a brand has results: shares of the window's emails. */
export const defaultMix: Readonly<Record<MixKind, number>> = Object.freeze({
  offer: 0.3,
  story: 0.2,
  education: 0.2,
  product: 0.3
})
/** At most this share of emails carry an offer (the plan's offer share). */
export const offerShareCap = developmentPolicy.discountCapPercent / 100
/** Emails that reached fewer people say too little to learn from (as `minRecipients` for A/B). */
const minPeople = 100
/** Each kind's rate leans toward the brand's average as if it had this many average emails more. */
const priorEmails = 10
/** No email counts for more than this many times the typical email (per person). */
const outlierCap = 3
/** A kind's weight moves at most this far from its default (before the shares are rescaled to 1). */
const maxShift = 0.5
/** Revenue is the measure when at least this share of counted emails had their orders read. */
const revenueCoverage = 0.8

export type EmailMix = {
  /** Whole emails of each kind, adding up to `emails` (all 0 for a bad count). */
  counts: Record<MixKind, number>
  /** Each kind's share before rounding (0 to 1, adding up to 1). */
  shares: Record<MixKind, number>
  /** 'learned' when the brand's results moved the mix away from the default. */
  basis: 'default' | 'learned'
  /** How many emails it learned from. */
  learnedFrom: number
  /** What "earned more" was measured by. */
  measure: 'revenue_per_person' | 'clicks_per_person' | null
}

const zero = (): Record<MixKind, number> => ({
  offer: 0,
  story: 0,
  education: 0,
  product: 0
})

/** Shares that add up to 1, with offers at most `offerShareCap`. */
function capOffers(weights: Record<MixKind, number>) {
  const total = mixKinds.reduce((sum, k) => sum + weights[k], 0)
  const out = zero()
  for (const k of mixKinds) out[k] = weights[k] / total
  if (out.offer > offerShareCap) {
    const rest = 1 - out.offer
    const spare = out.offer - offerShareCap
    out.offer = offerShareCap
    for (const k of mixKinds)
      if (k !== 'offer') out[k] += (out[k] / rest) * spare
  }
  return out
}

/** Whole emails among `kinds` by largest remainder (ties in `mixKinds` order). */
function largestRemainder(
  shares: Record<MixKind, number>,
  kinds: readonly MixKind[],
  emails: number,
  into: Record<MixKind, number>
) {
  const total = kinds.reduce((sum, k) => sum + shares[k], 0)
  const exact = kinds.map((k) => ({
    k,
    v: total > 0 ? (shares[k] / total) * emails : emails / kinds.length
  }))
  for (const { k, v } of exact) into[k] = Math.floor(v)
  let left = emails - kinds.reduce((sum, k) => sum + into[k], 0)
  for (const { k } of [...exact].sort(
    (a, b) =>
      b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)) ||
      mixKinds.indexOf(a.k) - mixKinds.indexOf(b.k)
  )) {
    if (left <= 0) break
    into[k] += 1
    left -= 1
  }
}

/** Whole emails: offers first (never above the caps), the rest shared by the other kinds. */
function toCounts(
  shares: Record<MixKind, number>,
  emails: number,
  maxOffers: number
) {
  const all = zero()
  largestRemainder(shares, mixKinds, emails, all)
  const offers = Math.min(
    all.offer,
    Math.floor(emails * offerShareCap + 1e-9),
    maxOffers
  )
  const counts = zero()
  counts.offer = offers
  largestRemainder(
    shares,
    mixKinds.filter((k) => k !== 'offer'),
    emails - offers,
    counts
  )
  return counts
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * The mix for `emails` emails in the next 15 days, from this brand's
 * Results lines (`resultsReadModel`). Only sent, final, real (not sample)
 * emails that reached at least 100 people count. "Earned more" is revenue
 * per person when at least 80% of them had their orders read (measured
 * over those), else clicks per person. Each kind's rate is pooled over its
 * emails (no email worth more than three typical ones) and leans toward
 * the brand's average until it has several emails.
 *
 * `maxOffers` (lane A): the offer emails the plan's rules allow in this
 * window (weekly offer share per audience, 7 days between offers, saved
 * offers at all); offers never go above it, nor above the 40% share.
 */
export function emailMix(
  lines: readonly ResultLine[],
  { emails, maxOffers = Infinity }: { emails: number; maxOffers?: number }
): EmailMix {
  const n = Number.isInteger(emails) && emails > 0 ? emails : 0
  const offerLimit =
    Number.isInteger(maxOffers) || maxOffers === Infinity
      ? Math.max(0, maxOffers)
      : 0
  const counted = lines.flatMap((l) => {
    const kind = l.emailType ? kindByType.get(l.emailType) : undefined
    const people = l.totals?.recipients ?? 0
    return kind &&
      l.status === 'sent' &&
      l.final &&
      !l.sample &&
      l.totals &&
      people >= minPeople
      ? [{ kind, totals: l.totals, people }]
      : []
  })
  const withRevenue = counted.filter(
    (u) => u.totals.revenue !== null && Number.isFinite(u.totals.revenue)
  )
  const byRevenue =
    counted.length > 0 && withRevenue.length >= revenueCoverage * counted.length
  const usable = (byRevenue ? withRevenue : counted).map((u) => ({
    kind: u.kind,
    people: u.people,
    perPerson: (byRevenue ? u.totals.revenue! : u.totals.clicks) / u.people
  }))
  const typical = usable.length ? median(usable.map((u) => u.perPerson)) : 0
  const capped = usable.map((u) => ({
    ...u,
    perPerson:
      typical > 0 ? Math.min(u.perPerson, outlierCap * typical) : u.perPerson
  }))
  const pooled = (list: typeof capped) => {
    const people = list.reduce((sum, u) => sum + u.people, 0)
    return people > 0
      ? list.reduce((sum, u) => sum + u.perPerson * u.people, 0) / people
      : 0
  }
  const average = pooled(capped)
  const weights = { ...defaultMix }
  let moved = false
  if (average > 0 && Number.isFinite(average))
    for (const k of mixKinds) {
      const mine = capped.filter((u) => u.kind === k)
      if (mine.length === 0) continue
      const rate =
        (mine.length * pooled(mine) + priorEmails * average) /
        (mine.length + priorEmails)
      const shift = Math.max(-maxShift, Math.min(maxShift, rate / average - 1))
      if (Math.abs(shift) > 1e-9) moved = true
      weights[k] = defaultMix[k] * (1 + shift)
    }
  const shares = capOffers(weights)
  return {
    counts: toCounts(shares, n, offerLimit),
    shares,
    basis: moved ? 'learned' : 'default',
    learnedFrom: moved ? capped.length : 0,
    measure: moved
      ? byRevenue
        ? 'revenue_per_person'
        : 'clicks_per_person'
      : null
  }
}
