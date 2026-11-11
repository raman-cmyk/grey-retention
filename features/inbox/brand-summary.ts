import { z } from 'zod'
import { angles, type Angle, type EmailFacts, type Offer } from './facts'

/**
 * What a competitor brand sends, from its own emails' facts (INB-003
 * "macro" facts): how often, which kinds of campaign, how deep its
 * discounts go, its text:design share, when it usually sends, and the
 * patterns it repeats. A pattern that repeats is a "this works" signal and
 * counts more than a one-off.
 */

export const summaryWindowDays = 90
/** A pattern seen this many times or more is repeated, not a one-off. */
export const repeatedAt = 2

/** Facts as stored: read defensively (an older or broken row is skipped). */
export const factsSchema = z.object({
  version: z.number().int().min(1),
  subject: z.string(),
  preview: z.string().nullable(),
  offer: z.object({
    kind: z.enum([
      'percent',
      'amount',
      'bogo',
      'gift',
      'free_shipping',
      'none'
    ]),
    value: z.number().nullable(),
    code: z.string().nullable()
  }),
  angle: z.enum(angles),
  cta: z.string().nullable(),
  sentAt: z.string(),
  blockSequence: z.array(z.string()),
  textRatio: z.number().nullable(),
  sections: z.number().int()
})

export type Pattern = {
  angle: Angle
  offer: Offer['kind']
  /** The first content blocks after the header, e.g. hero_image → text. */
  opening: string[]
  count: number
  /** Share of the brand's emails that follow it (0..1). */
  weight: number
  repeated: boolean
}

export type BrandSummary = {
  emails: number
  windowDays: number
  /**
   * Emails a week since the first one in the window (at least a week): a
   * brand followed for two weeks is not averaged over 90 days.
   */
  perWeek: number
  angles: { angle: Angle; count: number; share: number }[]
  discount: {
    /** Share of emails with any offer. */
    share: number
    /** The usual percent off, when there are percent offers. */
    typicalPercent: number | null
    kinds: { kind: Offer['kind']; count: number }[]
  }
  textRatio: number | null
  /**
   * The most common day and hour in the reader's timezone, once at least
   * two emails share it (one email is not a habit).
   */
  sends: { day: string; hour: number } | null
  patterns: Pattern[]
}

const chrome = new Set(['announcement_bar', 'header_logo', 'unsure'])
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b)
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : null
}
const top = <T>(counts: Map<T, number>) =>
  [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

export function brandSummary(
  rows: { facts: unknown }[],
  { now, timezone }: { now: number; timezone: string }
): BrandSummary | null {
  const since = now - summaryWindowDays * 86_400_000
  const facts: EmailFacts[] = rows.flatMap((r) => {
    const parsed = factsSchema.safeParse(r.facts)
    if (!parsed.success) return []
    const at = Date.parse(parsed.data.sentAt)
    return at >= since && at <= now ? [parsed.data as EmailFacts] : []
  })
  if (!facts.length) return null
  const n = facts.length
  const angleCounts = new Map<Angle, number>()
  const kindCounts = new Map<Offer['kind'], number>()
  const percents: number[] = []
  const ratios: number[] = []
  const when = new Map<string, number>()
  const patterns = new Map<string, Pattern>()
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    hour: 'numeric',
    hourCycle: 'h23'
  })
  for (const f of facts) {
    angleCounts.set(f.angle, (angleCounts.get(f.angle) ?? 0) + 1)
    if (f.offer.kind !== 'none')
      kindCounts.set(f.offer.kind, (kindCounts.get(f.offer.kind) ?? 0) + 1)
    if (f.offer.kind === 'percent' && f.offer.value !== null)
      percents.push(f.offer.value)
    if (f.textRatio !== null) ratios.push(f.textRatio)
    const parts = local.formatToParts(new Date(f.sentAt))
    const key = `${parts.find((p) => p.type === 'weekday')?.value}|${Number(parts.find((p) => p.type === 'hour')?.value)}`
    when.set(key, (when.get(key) ?? 0) + 1)
    const opening = f.blockSequence.filter((b) => !chrome.has(b)).slice(0, 3)
    const id = `${f.angle}|${f.offer.kind}|${opening.join('>')}`
    const p = patterns.get(id) ?? {
      angle: f.angle,
      offer: f.offer.kind,
      opening,
      count: 0,
      weight: 0,
      repeated: false
    }
    p.count++
    patterns.set(id, p)
  }
  const usual = top(when)
  const habit = usual !== null && (when.get(usual) ?? 0) >= repeatedAt
  const first = Math.min(...facts.map((f) => Date.parse(f.sentAt)))
  const days = Math.max(7, (now - first) / 86_400_000)
  const offers = [...kindCounts.values()].reduce((a, b) => a + b, 0)
  return {
    emails: n,
    windowDays: summaryWindowDays,
    perWeek: Math.round((n / (days / 7)) * 10) / 10,
    angles: [...angleCounts.entries()]
      .map(([angle, count]) => ({ angle, count, share: count / n }))
      .sort((a, b) => b.count - a.count),
    discount: {
      share: offers / n,
      typicalPercent: median(percents),
      kinds: [...kindCounts.entries()]
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count)
    },
    textRatio: ratios.length
      ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) /
        100
      : null,
    sends:
      habit && usual
        ? { day: usual.split('|')[0]!, hour: Number(usual.split('|')[1]) }
        : null,
    patterns: [...patterns.values()]
      .map((p) => ({
        ...p,
        weight: p.count / n,
        repeated: p.count >= repeatedAt
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }
}

/** One followed brand's summary, as the Inspiration page shows it. */
export type TrackedSummary = {
  domain: string
  label: string
  sample: boolean
  summary: BrandSummary
}

/**
 * The summaries of the brands a workspace follows, from their emails'
 * stored facts. Brands without labelled emails yet are left out.
 */
export function trackedSummaries(
  tracked: { domain: string; label: string; sample: boolean }[],
  factsByDomain: Record<string, { facts: unknown }[]>,
  { timezone, now = Date.now() }: { timezone: string; now?: number }
): TrackedSummary[] {
  return tracked.flatMap((t) => {
    const summary = brandSummary(factsByDomain[t.domain] ?? [], {
      now,
      timezone
    })
    return summary
      ? [{ domain: t.domain, label: t.label, sample: t.sample, summary }]
      : []
  })
}
