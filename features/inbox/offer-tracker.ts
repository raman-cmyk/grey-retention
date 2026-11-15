import { factsSchema } from './brand-summary'
import type { Offer } from './facts'

/**
 * CMP-049 (owner pick #49, D27): which discounts the competitors a
 * workspace follows run, week by week, from their emails' stored facts
 * (INB-003), in the reader's timezone. Weeks start on Monday.
 */
export const trackerWeeks = 12

export type OfferKind = Exclude<Offer['kind'], 'none'>

export type BrandWeek = {
  /** Emails that week (with or without an offer). */
  emails: number
  offers: { kind: OfferKind; emails: number }[]
  /** The deepest percent off that week, when there was one. */
  deepestPercent: number | null
  /** Codes shown that week (also on emails whose offer was not recognised), upper case, sorted. */
  codes: string[]
}

export type OfferTracker = {
  /** Monday of each week, oldest first, ending with this week. */
  weeks: string[]
  brands: {
    domain: string
    label: string
    /** One entry per week in `weeks`. */
    byWeek: BrandWeek[]
    /** Share of weeks with an email that had an offer or a code (0 to 1); null with no emails. */
    offerWeeks: number | null
    /** The usual percent off over the period: the median, lower middle, as the brand summary. */
    usualPercent: number | null
  }[]
  /** Across the brands, per week in `weeks` (`usualPercent`: the median of their deepest percents). */
  overall: { brandsWithOffer: number; usualPercent: number | null }[]
}

const dayMs = 86_400_000
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * dayMs)
    .toISOString()
    .slice(0, 10)
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** The median, lower middle: always a percent someone ran (as brandSummary). */
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b)
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : null
}
const realPercent = (v: number | null): v is number =>
  v !== null && Number.isInteger(v) && v >= 1 && v <= 100

/**
 * The tracker over the last `weeks` weeks (this one included), or null
 * when the timezone is not real. Brands keep the order given.
 */
export function offerTracker(
  brands: readonly {
    domain: string
    label: string
    rows: readonly { facts: unknown }[]
  }[],
  {
    now,
    timezone,
    weeks = trackerWeeks
  }: { now: number; timezone: string; weeks?: number }
): OfferTracker | null {
  if (!Number.isFinite(now)) return null
  let local: Intl.DateTimeFormat
  try {
    local = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short'
    })
  } catch {
    return null
  }
  const n = Number.isInteger(weeks)
    ? Math.min(104, Math.max(1, weeks))
    : trackerWeeks
  const mondayOf = (time: number) => {
    const p = Object.fromEntries(
      local.formatToParts(new Date(time)).map((x) => [x.type, x.value])
    )
    return addDays(
      `${p.year}-${p.month}-${p.day}`,
      -weekdays.indexOf(p.weekday!)
    )
  }
  const thisWeek = mondayOf(now)
  const list = Array.from({ length: n }, (_, i) =>
    addDays(thisWeek, -7 * (n - 1 - i))
  )
  const index = new Map(list.map((w, i) => [w, i]))
  // Two days of slack for any timezone; older (or odd) times are skipped
  // before their week is worked out.
  const earliest = Date.parse(`${list[0]}T00:00:00Z`) - 2 * dayMs

  const tracked = brands.map((brand) => {
    const byWeek: BrandWeek[] = list.map(() => ({
      emails: 0,
      offers: [],
      deepestPercent: null,
      codes: []
    }))
    const percents: number[] = []
    for (const r of brand.rows) {
      const parsed = factsSchema.safeParse(r.facts)
      if (!parsed.success) continue
      const time = Date.parse(parsed.data.sentAt)
      if (Number.isNaN(time) || time > now || time < earliest) continue
      const i = index.get(mondayOf(time))
      if (i === undefined) continue
      const week = byWeek[i]!
      week.emails += 1
      const offer = parsed.data.offer
      const code = offer.code?.trim().toUpperCase()
      if (code && !week.codes.includes(code)) week.codes.push(code)
      // A percent outside 1 to 100 (such as "0% off") is no offer.
      if (
        offer.kind === 'none' ||
        (offer.kind === 'percent' && !realPercent(offer.value))
      )
        continue
      const entry = week.offers.find((o) => o.kind === offer.kind)
      if (entry) entry.emails += 1
      else week.offers.push({ kind: offer.kind, emails: 1 })
      if (offer.kind === 'percent' && realPercent(offer.value)) {
        week.deepestPercent = Math.max(week.deepestPercent ?? 0, offer.value)
        percents.push(offer.value)
      }
    }
    for (const w of byWeek) {
      w.offers.sort(
        (a, b) => b.emails - a.emails || a.kind.localeCompare(b.kind)
      )
      w.codes.sort()
    }
    const active = byWeek.filter((w) => w.emails > 0)
    return {
      domain: brand.domain,
      label: brand.label,
      byWeek,
      offerWeeks: active.length
        ? Math.round(
            (active.filter((w) => w.offers.length > 0 || w.codes.length > 0)
              .length /
              active.length) *
              100
          ) / 100
        : null,
      usualPercent: median(percents)
    }
  })
  return {
    weeks: list,
    brands: tracked,
    overall: list.map((_, i) => ({
      brandsWithOffer: tracked.filter(
        (b) => b.byWeek[i]!.offers.length > 0 || b.byWeek[i]!.codes.length > 0
      ).length,
      usualPercent: median(
        tracked.flatMap((b) =>
          b.byWeek[i]!.deepestPercent === null
            ? []
            : [b.byWeek[i]!.deepestPercent!]
        )
      )
    }))
  }
}
