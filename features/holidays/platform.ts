/**
 * Platform holidays & events (docs/UI_REBUILD_SPEC.md §12, OWNER_JOURNEYS
 * §18 decision 20): computed per country, never stored. Dates are plain
 * calendar dates (YYYY-MM-DD); the brand's own timezone decides "today".
 *
 * Category colours the chips: civic (public holidays), cultural
 * (celebrations and gift days), commercial (shopping days).
 */
export type HolidayCountry = 'US' | 'GB' | 'AU' | 'CA' | 'NZ' | 'IN' | 'INTL'
export type HolidayCategory = 'civic' | 'cultural' | 'commercial'
export type PlatformHoliday = {
  date: string
  name: string
  category: HolidayCategory
}

export const holidayCountries: { code: HolidayCountry; label: string }[] = [
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'AU', label: 'Australia' },
  { code: 'CA', label: 'Canada' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'IN', label: 'India' },
  { code: 'INTL', label: 'International (shopping days only)' }
]
export const isHolidayCountry = (value: string): value is HolidayCountry =>
  holidayCountries.some((c) => c.code === value)

/** A first guess from the workspace timezone; the owner can change it. */
export function countryFromTimezone(timezone: string): HolidayCountry {
  const zone = timezone.trim()
  if (
    /^(US\/|America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Indiana|Kentucky|North_Dakota|Juneau|Sitka|Nome|Adak|Menominee|Metlakatla|Yakutat)|Pacific\/Honolulu)/.test(
      zone
    )
  )
    return 'US'
  if (
    /^(Canada\/|America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Moncton|Whitehorse|Yellowknife|Iqaluit|Glace_Bay|Goose_Bay|Swift_Current|Dawson|Inuvik|Rankin_Inlet|Resolute|Cambridge_Bay|Creston|Fort_Nelson))/.test(
      zone
    )
  )
    return 'CA'
  if (/^(Europe\/(London|Belfast)|GB)$/.test(zone)) return 'GB'
  if (/^Australia\//.test(zone)) return 'AU'
  if (/^(Pacific\/(Auckland|Chatham)|NZ)$/.test(zone)) return 'NZ'
  if (/^Asia\/(Kolkata|Calcutta)$/.test(zone)) return 'IN'
  return 'INTL'
}

type Day = { y: number; m: number; d: number }
const iso = ({ y, m, d }: Day) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const utc = ({ y, m, d }: Day) => new Date(Date.UTC(y, m - 1, d))
const fromDate = (date: Date): Day => ({
  y: date.getUTCFullYear(),
  m: date.getUTCMonth() + 1,
  d: date.getUTCDate()
})
const addDays = (day: Day, days: number) =>
  fromDate(new Date(utc(day).getTime() + days * 86_400_000))

/** The n-th weekday (0 = Sunday) of a month; n = -1 is the last one. */
function nthWeekday(y: number, m: number, weekday: number, n: number): Day {
  if (n > 0) {
    const first = utc({ y, m, d: 1 }).getUTCDay()
    return { y, m, d: 1 + ((weekday - first + 7) % 7) + (n - 1) * 7 }
  }
  const last = new Date(Date.UTC(y, m, 0))
  const back = (last.getUTCDay() - weekday + 7) % 7
  return { y, m, d: last.getUTCDate() - back }
}

/** Easter Sunday (Gregorian, anonymous algorithm). */
export function easter(y: number): Day {
  const a = y % 19
  const b = Math.floor(y / 100)
  const c = y % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { y, m: month, d: day }
}

/** Moon-calendar dates, listed until 2030 (later years are not shown). */
const lunar: Record<string, Record<number, string>> = {
  hanukkah: {
    2026: '2026-12-04',
    2027: '2027-12-24',
    2028: '2028-12-12',
    2029: '2029-12-01',
    2030: '2030-12-20'
  },
  diwali: {
    2026: '2026-11-08',
    2027: '2027-10-29',
    2028: '2028-10-17',
    2029: '2029-11-05',
    2030: '2030-10-26'
  },
  holi: {
    2026: '2026-03-04',
    2027: '2027-03-22',
    2028: '2028-03-11',
    2029: '2029-03-01',
    2030: '2030-03-20'
  },
  lunarNewYear: {
    2026: '2026-02-17',
    2027: '2027-02-06',
    2028: '2028-01-26',
    2029: '2029-02-13',
    2030: '2030-02-03'
  },
  matariki: {
    2026: '2026-07-10',
    2027: '2027-06-25',
    2028: '2028-07-14',
    2029: '2029-07-06',
    2030: '2030-06-21'
  }
}

type Rule = {
  name: string
  category: HolidayCategory
  on: (y: number) => string | null
}
const fixed = (
  name: string,
  category: HolidayCategory,
  m: number,
  d: number
): Rule => ({
  name,
  category,
  on: (y) => iso({ y, m, d })
})
const nth = (
  name: string,
  category: HolidayCategory,
  m: number,
  weekday: number,
  n: number
): Rule => ({ name, category, on: (y) => iso(nthWeekday(y, m, weekday, n)) })
const fromEaster = (
  name: string,
  category: HolidayCategory,
  days: number
): Rule => ({
  name,
  category,
  on: (y) => iso(addDays(easter(y), days))
})
const moon = (name: string, category: HolidayCategory, key: string): Rule => ({
  name,
  category,
  on: (y) => lunar[key]?.[y] ?? null
})
/** US Thanksgiving: fourth Thursday of November; shopping days follow it. */
const thanksgiving = (y: number) => nthWeekday(y, 11, 4, 4)
const afterThanksgiving = (name: string, days: number): Rule => ({
  name,
  category: 'commercial',
  on: (y) => iso(addDays(thanksgiving(y), days))
})
/** Canada's Victoria Day: the Monday before 25 May. */
const victoriaDay: Rule = {
  name: 'Victoria Day',
  category: 'civic',
  on: (y) =>
    iso(
      addDays(
        { y, m: 5, d: 25 },
        -((utc({ y, m: 5, d: 25 }).getUTCDay() + 6) % 7 || 7)
      )
    )
}

const shopping: Rule[] = [
  fixed('Valentine’s Day', 'cultural', 2, 14),
  afterThanksgiving('Black Friday', 1),
  afterThanksgiving('Cyber Monday', 4),
  fixed('Christmas Eve', 'cultural', 12, 24),
  fixed('Christmas Day', 'cultural', 12, 25),
  fixed('New Year’s Eve', 'cultural', 12, 31),
  fixed('New Year’s Day', 'civic', 1, 1)
]

const sets: Record<HolidayCountry, Rule[]> = {
  US: [
    ...shopping,
    nth('Martin Luther King Jr. Day', 'civic', 1, 1, 3),
    nth('Presidents’ Day', 'civic', 2, 1, 3),
    fixed('St. Patrick’s Day', 'cultural', 3, 17),
    fromEaster('Easter', 'cultural', 0),
    nth('Mother’s Day', 'cultural', 5, 0, 2),
    nth('Memorial Day', 'civic', 5, 1, -1),
    nth('Father’s Day', 'cultural', 6, 0, 3),
    fixed('Juneteenth', 'civic', 6, 19),
    fixed('Independence Day', 'civic', 7, 4),
    nth('Labor Day', 'civic', 9, 1, 1),
    fixed('Halloween', 'cultural', 10, 31),
    fixed('Veterans Day', 'civic', 11, 11),
    {
      name: 'Thanksgiving',
      category: 'civic',
      on: (y) => iso(thanksgiving(y))
    },
    afterThanksgiving('Giving Tuesday', 5),
    moon('Hanukkah begins', 'cultural', 'hanukkah'),
    fixed('Free Shipping Day', 'commercial', 12, 14),
    fixed('Boxing Day', 'commercial', 12, 26)
  ],
  GB: [
    ...shopping,
    fromEaster('Mother’s Day', 'cultural', -21),
    fromEaster('Good Friday', 'civic', -2),
    fromEaster('Easter Monday', 'civic', 1),
    nth('Early May bank holiday', 'civic', 5, 1, 1),
    nth('Spring bank holiday', 'civic', 5, 1, -1),
    nth('Father’s Day', 'cultural', 6, 0, 3),
    nth('Summer bank holiday', 'civic', 8, 1, -1),
    fixed('Halloween', 'cultural', 10, 31),
    fixed('Bonfire Night', 'cultural', 11, 5),
    nth('Remembrance Sunday', 'civic', 11, 0, 2),
    fixed('Boxing Day', 'civic', 12, 26)
  ],
  AU: [
    ...shopping,
    fixed('Australia Day', 'civic', 1, 26),
    fromEaster('Good Friday', 'civic', -2),
    fromEaster('Easter Monday', 'civic', 1),
    fixed('Anzac Day', 'civic', 4, 25),
    nth('Mother’s Day', 'cultural', 5, 0, 2),
    nth('King’s Birthday (most states)', 'civic', 6, 1, 2),
    nth('Father’s Day', 'cultural', 9, 0, 1),
    fixed('Halloween', 'cultural', 10, 31),
    fixed('Boxing Day', 'civic', 12, 26)
  ],
  CA: [
    ...shopping,
    nth('Family Day (most provinces)', 'civic', 2, 1, 3),
    fromEaster('Good Friday', 'civic', -2),
    fromEaster('Easter', 'cultural', 0),
    nth('Mother’s Day', 'cultural', 5, 0, 2),
    victoriaDay,
    nth('Father’s Day', 'cultural', 6, 0, 3),
    fixed('Canada Day', 'civic', 7, 1),
    nth('Civic Holiday', 'civic', 8, 1, 1),
    nth('Labour Day', 'civic', 9, 1, 1),
    nth('Thanksgiving', 'civic', 10, 1, 2),
    fixed('Halloween', 'cultural', 10, 31),
    fixed('Remembrance Day', 'civic', 11, 11),
    fixed('Boxing Day', 'civic', 12, 26)
  ],
  NZ: [
    ...shopping,
    fixed('Waitangi Day', 'civic', 2, 6),
    fromEaster('Good Friday', 'civic', -2),
    fromEaster('Easter Monday', 'civic', 1),
    fixed('Anzac Day', 'civic', 4, 25),
    nth('Mother’s Day', 'cultural', 5, 0, 2),
    nth('King’s Birthday', 'civic', 6, 1, 1),
    moon('Matariki', 'civic', 'matariki'),
    nth('Father’s Day', 'cultural', 9, 0, 1),
    nth('Labour Day', 'civic', 10, 1, 4),
    fixed('Halloween', 'cultural', 10, 31),
    fixed('Boxing Day', 'civic', 12, 26)
  ],
  IN: [
    ...shopping,
    fixed('Republic Day', 'civic', 1, 26),
    moon('Holi', 'cultural', 'holi'),
    nth('Mother’s Day', 'cultural', 5, 0, 2),
    nth('Father’s Day', 'cultural', 6, 0, 3),
    fixed('Independence Day', 'civic', 8, 15),
    fixed('Gandhi Jayanti', 'civic', 10, 2),
    moon('Diwali', 'cultural', 'diwali')
  ],
  INTL: [
    ...shopping,
    moon('Lunar New Year', 'cultural', 'lunarNewYear'),
    nth('Mother’s Day (many countries)', 'cultural', 5, 0, 2),
    nth('Father’s Day (many countries)', 'cultural', 6, 0, 3),
    fixed('Halloween', 'cultural', 10, 31)
  ]
}

/**
 * The country's platform holidays from `from` (YYYY-MM-DD, the brand's
 * today) for `days` days, in date order.
 */
export function platformHolidays({
  country,
  from,
  days = 90
}: {
  country: HolidayCountry
  from: string
  days?: number
}): PlatformHoliday[] {
  const [y, m, d] = from.split('-').map(Number) as [number, number, number]
  const start = { y, m, d }
  const end = iso(addDays(start, days))
  const years = [y, y + 1]
  const found: PlatformHoliday[] = []
  for (const rule of sets[country])
    for (const year of years) {
      const date = rule.on(year)
      if (date && date >= from && date < end)
        found.push({ date, name: rule.name, category: rule.category })
    }
  return found.sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)
  )
}
