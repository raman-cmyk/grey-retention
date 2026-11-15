import { developmentPolicy } from '@/features/workflow/domain/policy'
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
const kindByType: Record<string, MixKind> = {
  offer: 'offer',
  story: 'story',
  education: 'education',
  launch: 'product',
  bestseller: 'product',
  'gift guide': 'product',
  restock: 'product',
  reminder: 'product'
}

/** The mix before a brand has results: shares of the window's emails. */
export const defaultMix: Readonly<Record<MixKind, number>> = Object.freeze({
  offer: 0.3,
  story: 0.2,
  education: 0.2,
  product: 0.3
})
/** At most this share of emails carry an offer (the plan's offer share). */
export const offerShareCap = developmentPolicy.discountCapPercent / 100
/** A kind's results count half after this many emails, more after more. */
const trustAfter = 5
/** A kind's share moves at most this far from its default (as a fraction of it). */
const maxShift = 0.5

export type EmailMix = {
  /** Whole emails of each kind, adding up to `emails`. */
  counts: Record<MixKind, number>
  /** Each kind's share before rounding (0 to 1, adding up to 1). */
  shares: Record<MixKind, number>
  /** 'learned' when at least one usable email moved the mix. */
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
function capOffers(shares: Record<MixKind, number>) {
  const total = mixKinds.reduce((sum, k) => sum + shares[k], 0)
  const out = zero()
  for (const k of mixKinds) out[k] = shares[k] / total
  if (out.offer > offerShareCap) {
    const rest = 1 - out.offer
    const spare = out.offer - offerShareCap
    out.offer = offerShareCap
    for (const k of mixKinds)
      if (k !== 'offer')
        out[k] += rest > 0 ? (out[k] / rest) * spare : spare / 3
  }
  return out
}

/** Whole emails by largest remainder; offers never above the cap. */
function toCounts(shares: Record<MixKind, number>, emails: number) {
  const counts = zero()
  const exact = mixKinds.map((k) => ({ k, v: shares[k] * emails }))
  for (const { k, v } of exact) counts[k] = Math.floor(v)
  let left = emails - mixKinds.reduce((sum, k) => sum + counts[k], 0)
  const order = [...exact].sort(
    (a, b) =>
      b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)) ||
      mixKinds.indexOf(a.k) - mixKinds.indexOf(b.k)
  )
  for (const { k } of order) {
    if (left <= 0) break
    counts[k] += 1
    left -= 1
  }
  const maxOffers = Math.floor(emails * offerShareCap + 1e-9)
  while (counts.offer > maxOffers) {
    counts.offer -= 1
    const next = order.find(({ k }) => k !== 'offer')!.k
    counts[next] += 1
  }
  return counts
}

/**
 * The mix for `emails` emails in the next 15 days, from this brand's
 * Results lines (`resultsReadModel`). Only sent, final, real (not sample)
 * emails with people reached count. "Earned more" is revenue per person
 * when every counted email's orders were read, else clicks per person.
 */
export function emailMix(
  lines: readonly ResultLine[],
  { emails }: { emails: number }
): EmailMix {
  const n = Number.isInteger(emails) && emails > 0 ? emails : 0
  const usable = lines.flatMap((l) => {
    const kind = l.emailType ? kindByType[l.emailType] : undefined
    const people = l.totals?.recipients ?? 0
    return kind &&
      l.status === 'sent' &&
      l.final &&
      !l.sample &&
      l.totals &&
      people > 0
      ? [{ kind, totals: l.totals, people }]
      : []
  })
  const byRevenue =
    usable.length > 0 && usable.every((u) => u.totals.revenue !== null)
  const value = (u: (typeof usable)[number]) =>
    (byRevenue ? u.totals.revenue! : u.totals.clicks) / u.people
  const average =
    usable.length > 0
      ? usable.reduce((sum, u) => sum + value(u), 0) / usable.length
      : 0
  const weights = { ...defaultMix }
  if (average > 0)
    for (const k of mixKinds) {
      const mine = usable.filter((u) => u.kind === k)
      if (mine.length === 0) continue
      const mean = mine.reduce((sum, u) => sum + value(u), 0) / mine.length
      const trust = mine.length / (mine.length + trustAfter)
      const shift = Math.max(
        -maxShift,
        Math.min(maxShift, trust * (mean / average - 1))
      )
      weights[k] = defaultMix[k] * (1 + shift)
    }
  const shares = capOffers(weights)
  const learned = average > 0
  return {
    counts: toCounts(shares, n),
    shares,
    basis: learned ? 'learned' : 'default',
    learnedFrom: learned ? usable.length : 0,
    measure: learned
      ? byRevenue
        ? 'revenue_per_person'
        : 'clicks_per_person'
      : null
  }
}
