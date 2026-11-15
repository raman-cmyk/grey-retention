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
 * Whole words (not part of a longer word or a hyphenated one), so
 * "category" is not "cat", "puppet" is not "puppy" and "cat-eye" is not a
 * cat. `not`: phrases that look like a match but are not ("hot dogs").
 */
const words = (list: string, not?: string) =>
  new RegExp(
    `${not ? `^(?!.*\\b(?:${not})\\b)` : ''}.*(?<![\\w-])(?:${list})(?![\\w-])`,
    'i'
  )
const pets = words(
  'pets?|petcare|dogs?|puppy|puppies|cats?|kittens?|canine|feline',
  'hot dogs?|kitten heels?'
)

/**
 * Industry days, matched from the brand's industry in words (English).
 * Well-known fixed days only; an industry that matches none gets none.
 * `unless`: never for these brands (chocolate is poison to pets).
 */
const industryDays: {
  match: RegExp
  unless?: RegExp
  days: Extra[]
  only?: HolidayCountry[]
}[] = [
  {
    match: pets,
    days: [
      day('International Cat Day', fixed(8, 8)),
      day('International Dog Day', fixed(8, 26))
    ]
  },
  { match: pets, only: ['US'], days: [day('National Pet Day', fixed(4, 11))] },
  {
    match: words(
      'chocolates?|chocolatier|confectionery|confections?|sweets|candy|candies|bakery|bakeries|desserts?|patisserie'
    ),
    unless: pets,
    days: [day('World Chocolate Day', fixed(7, 7))]
  },
  {
    match: words('coffee|espresso|teas?|matcha|teaware|cafe|café'),
    days: [
      day('International Tea Day', fixed(5, 21)),
      day('International Coffee Day', fixed(10, 1))
    ]
  },
  {
    match: words(
      'fitness|yoga|wellness|wellbeing|well-being|health|supplements?|gym|activewear|athleisure'
    ),
    days: [
      day('World Health Day', fixed(4, 7)),
      day('International Day of Yoga', fixed(6, 21)),
      day('World Mental Health Day', fixed(10, 10))
    ]
  },
  {
    match: new RegExp(
      `${words('eco|sustainable|sustainability|organic|outdoors?|garden|gardening|plants?|zero[- ]?waste|refills?|refillable').source}|(?<![\\w-])eco-`,
      'i'
    ),
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
  [/^Black Friday$/, 7],
  // A public holiday in GB, AU, CA and NZ, and their biggest sale day.
  [/^Boxing Day$/, 5]
]
const saleByName = /^Boxing Day$/
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
/** How far past the window to look for calendar dates: the longest lead. */
const longestLead = Math.max(
  ...leadByName.map(([, lead]) => lead),
  ...Object.values(leadByCategory)
)
const ownLead = 3
/** The longest window asked for (a month and a bit). */
export const keyDatesMaxDays = 62

/** A real calendar day, YYYY-MM-DD. */
const realDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  return iso(addDays({ y, m, d }, 0)) === value
}
/** One date once: the same day and name, whatever the apostrophes or spaces. */
const sameKey = (date: string, name: string) =>
  `${date} ${name.toLowerCase().replace(/[‘’`]/g, "'").replace(/\s+/g, ' ').trim()}`

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
  if (
    !realDay(from) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > keyDatesMaxDays
  )
    return []
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
    const key = sameKey(date, name)
    const earlier = found.get(key)
    // The owner's own entry with a calendar date's name keeps the
    // calendar's kind and lead, and adds the owner's name and notes.
    if (earlier) {
      if (source === 'own')
        found.set(key, {
          ...earlier,
          name,
          source,
          ...(notes ? { notes } : {})
        })
      return
    }
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
    const kind = saleByName.test(h.name) ? 'sale' : kindByCategory[h.category]
    add(h.date, h.name, kind, 'calendar', lead)
  }
  const extras = [
    ...(financialYear[country] ?? []),
    ...moreShopping[country],
    ...industryDays
      .filter(
        (group) =>
          group.match.test(industry) &&
          !group.unless?.test(industry) &&
          (!group.only || group.only.includes(country))
      )
      .flatMap((group) => group.days)
  ]
  for (const extra of extras)
    for (const year of [y, y + 1])
      add(extra.on(year), extra.name, extra.kind, extra.source, extra.lead)
  for (const entry of own) {
    if (!realDay(entry.date)) continue
    const date = entry.repeatsAnnually
      ? nextOccurrence(entry.date, from)
      : entry.date
    add(date, entry.name, entry.kind, 'own', ownLead, entry.notes.trim())
  }
  return [...found.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)
  )
}

/**
 * The planner's date rows (`pulse.ts` `dates`): a sale is an event there.
 * Lane A: the pulse keeps dates inside the 15 days only (`gatherEvidence`)
 * and its rows have no lead, so a date whose emails start inside the
 * window but falls after it (Christmas, planning from 1 December) needs
 * the pulse widened, or `emailsFrom` passed another way.
 */
export const toPulseDates = (dates: KeyDate[]) =>
  dates.map((k) => ({
    date: k.date,
    name: Array.from(k.name).slice(0, 80).join(''),
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
  const days = input.days ?? 15
  if (
    !uuid.test(input.tenantId) ||
    !realDay(input.from) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > keyDatesMaxDays
  )
    return null
  const read = async () =>
    Promise.all([
      db
        .from('holidays')
        .select('name,event_date,kind,repeats_annually,notes')
        .eq('tenant_id', input.tenantId)
        // Only entries that can still come up: yearly ones, and one-off
        // ones from the window's first day (so old ones never crowd out
        // new ones under the limit).
        .or(`repeats_annually.eq.true,event_date.gte.${input.from}`)
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
      days,
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
