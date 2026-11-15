import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { nextOccurrence } from './entries'
import {
  addDays,
  countryFromTimezone,
  isHolidayCountry,
  iso,
  nthWeekday,
  platformHolidays,
  thanksgiving,
  type HolidayCategory,
  type HolidayCountry
} from './platform'

/**
 * PLN-034 (owner pick #34, D27): the key dates "Plan next 15 days" plans
 * around. World dates per country (the Holidays page's list), the end of
 * the financial year, a few more shopping days, industry days matched from
 * the brand's industry, and the owner's own holidays and events.
 *
 * Each date has a lead time: how many days before it the emails start.
 * A date counts for a window when its emails start inside the window, even
 * if the day itself is after it (planning 1 to 15 December includes
 * Christmas, whose emails start on 11 December).
 */

/** The kinds the competitor step matches dates by (`DateKind`). */
export type KeyDateKind = 'holiday' | 'sale' | 'event'
export type KeyDateSource = 'calendar' | 'financial_year' | 'industry' | 'own'

export type KeyDate = {
  /** YYYY-MM-DD, the brand's calendar. */
  date: string
  name: string
  kind: KeyDateKind
  source: KeyDateSource
  /** Days before `date` the emails start. */
  leadDays: number
  /** The first day to email about it: `date - leadDays`, not before the window. */
  emailsFrom: string
  /** The owner's own note, for their own entries. */
  notes?: string
}

/** The owner's own entry, as `holidays` stores it. */
export type OwnDate = {
  name: string
  date: string
  kind: 'holiday' | 'event'
  repeatsAnnually: boolean
  notes: string
}

type Extra = {
  name: string
  kind: KeyDateKind
  source: KeyDateSource
  lead: number
  on: (y: number) => string
}
const fixed =
  (m: number, d: number) =>
  (y: number): string =>
    iso({ y, m, d })

/** End of the financial (or tax) year, where it moves shopping. */
const financialYear: Partial<Record<HolidayCountry, Extra[]>> = {
  AU: [
    {
      name: 'End of financial year (EOFY) sales',
      kind: 'sale',
      source: 'financial_year',
      lead: 14,
      on: fixed(6, 30)
    }
  ],
  NZ: [
    {
      name: 'End of financial year',
      kind: 'event',
      source: 'financial_year',
      lead: 7,
      on: fixed(3, 31)
    }
  ],
  IN: [
    {
      name: 'End of financial year',
      kind: 'event',
      source: 'financial_year',
      lead: 7,
      on: fixed(3, 31)
    }
  ],
  GB: [
    {
      name: 'End of the tax year',
      kind: 'event',
      source: 'financial_year',
      lead: 7,
      on: fixed(4, 5)
    }
  ]
}

const sale = (
  name: string,
  lead: number,
  on: (y: number) => string
): Extra => ({
  name,
  kind: 'sale',
  source: 'calendar',
  lead,
  on
})
const singlesDay = sale('Singles’ Day', 5, fixed(11, 11))
const womensDay: Extra = {
  name: 'International Women’s Day',
  kind: 'holiday',
  source: 'calendar',
  lead: 5,
  on: fixed(3, 8)
}

/** Shopping days the Holidays page does not list. */
const moreShopping: Record<HolidayCountry, Extra[]> = {
  US: [
    womensDay,
    // The Saturday after Thanksgiving.
    sale('Small Business Saturday', 5, (y) => iso(addDays(thanksgiving(y), 2)))
  ],
  // The first Saturday of December.
  GB: [
    womensDay,
    sale('Small Business Saturday', 5, (y) => iso(nthWeekday(y, 12, 6, 1)))
  ],
  AU: [womensDay, singlesDay],
  CA: [womensDay],
  NZ: [womensDay, singlesDay],
  IN: [womensDay],
  INTL: [womensDay, singlesDay]
}

const day = (name: string, on: (y: number) => string): Extra => ({
  name,
  kind: 'event',
  source: 'industry',
  lead: 3,
  on
})
/**
 * Industry days, matched from the brand's industry in words. Well-known
 * fixed days only; an industry that matches none simply gets none.
 */
const industryDays: {
  match: RegExp
  days: Extra[]
  only?: HolidayCountry[]
}[] = [
  {
    match: /\bpets?\b|\bdogs?\b|\bcats?\b|pupp|kitten/i,
    days: [
      day('International Cat Day', fixed(8, 8)),
      day('International Dog Day', fixed(8, 26))
    ]
  },
  {
    match: /\bpets?\b|\bdogs?\b|\bcats?\b|pupp|kitten/i,
    only: ['US'],
    days: [day('National Pet Day', fixed(4, 11))]
  },
  {
    match: /chocolate|confection|sweets|candy|bakery|dessert|treats/i,
    days: [day('World Chocolate Day', fixed(7, 7))]
  },
  {
    match: /coffee|\btea\b|\bteas\b|caf[eé]/i,
    days: [
      day('International Tea Day', fixed(5, 21)),
      day('International Coffee Day', fixed(10, 1))
    ]
  },
  {
    match:
      /fitness|yoga|wellness|wellbeing|well-being|health|supplement|\bgym\b|activewear|athleisure/i,
    days: [
      day('World Health Day', fixed(4, 7)),
      day('International Day of Yoga', fixed(6, 21)),
      day('World Mental Health Day', fixed(10, 10))
    ]
  },
  {
    match:
      /\beco\b|eco-|sustainab|organic|outdoor|garden|\bplants?\b|zero[- ]?waste|refill/i,
    days: [
      day('Earth Day', fixed(4, 22)),
      day('World Environment Day', fixed(6, 5))
    ]
  }
]

/** Gift days need time for shipping; big sale days start early. */
const leadByName: [RegExp, number][] = [
  [/^Christmas Day$/, 14],
  [/^(Valentine’s Day|Mother’s Day|Father’s Day)/, 10],
  [/^(Hanukkah begins|Diwali|Lunar New Year)$/, 10],
  [/^Black Friday$/, 7]
]
const leadByCategory: Record<HolidayCategory, number> = {
  commercial: 5,
  cultural: 3,
  civic: 3
}
const kindByCategory: Record<HolidayCategory, KeyDateKind> = {
  commercial: 'sale',
  cultural: 'holiday',
  civic: 'holiday'
}
/** The longest lead above: how far past the window to look. */
const longestLead = 14
const ownLead = 3

const validDay = /^\d{4}-\d{2}-\d{2}$/

/**
 * The key dates for the window `from` (the first day, YYYY-MM-DD in the
 * brand's calendar) for `days` days, in date order.
 */
export function keyDates({
  country,
  from,
  days = 15,
  industry = '',
  own = []
}: {
  country: HolidayCountry
  from: string
  days?: number
  industry?: string
  own?: OwnDate[]
}): KeyDate[] {
  if (!validDay.test(from) || !Number.isInteger(days) || days < 1) return []
  const [y, m, d] = from.split('-').map(Number) as [number, number, number]
  const start = { y, m, d }
  const end = iso(addDays(start, days))
  const found = new Map<string, KeyDate>()
  const add = (
    date: string,
    name: string,
    kind: KeyDateKind,
    source: KeyDateSource,
    leadDays: number,
    notes?: string
  ) => {
    const [dy, dm, dd] = date.split('-').map(Number) as [number, number, number]
    const first = iso(addDays({ y: dy, m: dm, d: dd }, -leadDays))
    if (date < from || first >= end) return
    const key = `${date} ${name.toLowerCase()}`
    if (found.has(key)) return
    found.set(key, {
      date,
      name,
      kind,
      source,
      leadDays,
      emailsFrom: first < from ? from : first,
      ...(notes ? { notes } : {})
    })
  }
  for (const h of platformHolidays({
    country,
    from,
    days: days + longestLead
  })) {
    const lead =
      leadByName.find(([name]) => name.test(h.name))?.[1] ??
      leadByCategory[h.category]
    add(h.date, h.name, kindByCategory[h.category], 'calendar', lead)
  }
  const extras = [
    ...(financialYear[country] ?? []),
    ...moreShopping[country],
    ...industryDays
      .filter(
        (group) =>
          group.match.test(industry) &&
          (!group.only || group.only.includes(country))
      )
      .flatMap((group) => group.days)
  ]
  for (const extra of extras)
    for (const year of [y, y + 1])
      add(extra.on(year), extra.name, extra.kind, extra.source, extra.lead)
  for (const entry of own) {
    if (!validDay.test(entry.date)) continue
    const date = entry.repeatsAnnually
      ? nextOccurrence(entry.date, from)
      : entry.date
    add(date, entry.name, entry.kind, 'own', ownLead, entry.notes.trim())
  }
  return [...found.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)
  )
}

/** The planner's date rows (`pulse.ts` `dates`): a sale is an event there. */
export const toPulseDates = (dates: KeyDate[]) =>
  dates.map((k) => ({
    date: k.date,
    name: k.name.slice(0, 80),
    kind: k.kind === 'sale' ? ('event' as const) : k.kind
  }))

type Db = SupabaseClient<Database>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** More than any workspace keeps (the Holidays page's limit). */
const ownLimit = 500

/**
 * The workspace's key dates: its saved country (or the guess from its
 * timezone) and its own holidays and events. Works with a member's client
 * (RLS) or the worker's. Null when either read fails, never a guess.
 */
export async function planningKeyDates(
  db: Db,
  input: {
    tenantId: string
    timezone: string
    from: string
    days?: number
    industry?: string
  }
): Promise<{
  country: HolidayCountry
  countrySource: 'saved' | 'guess'
  dates: KeyDate[]
} | null> {
  if (!uuid.test(input.tenantId) || !validDay.test(input.from)) return null
  const read = async () =>
    Promise.all([
      db
        .from('holidays')
        .select('name,event_date,kind,repeats_annually,notes')
        .eq('tenant_id', input.tenantId)
        .order('event_date')
        .limit(ownLimit),
      db
        .from('holiday_preferences')
        .select('country')
        .eq('tenant_id', input.tenantId)
        .maybeSingle()
    ])
  const [rows, preference] = await read().catch(() => [null, null] as const)
  if (!rows || !preference || rows.error || preference.error) return null
  const saved = preference.data?.country
  const country =
    saved && isHolidayCountry(saved)
      ? saved
      : countryFromTimezone(input.timezone)
  return {
    country,
    countrySource: saved && isHolidayCountry(saved) ? 'saved' : 'guess',
    dates: keyDates({
      country,
      from: input.from,
      days: input.days,
      industry: input.industry,
      own: (rows.data ?? []).map((r) => ({
        name: r.name,
        date: r.event_date,
        kind: r.kind === 'holiday' ? 'holiday' : 'event',
        repeatsAnnually: r.repeats_annually,
        notes: r.notes ?? ''
      }))
    })
  }
}
