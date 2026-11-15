// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { DateKind } from '@/features/strategy/competitors'
import {
  keyDates,
  planningKeyDates,
  toPulseDates,
  type KeyDateKind
} from './key-dates'
import type { HolidayCountry } from './platform'

// The competitor step matches dates by the same kinds (compile-time check).
const sameKinds: [KeyDateKind, DateKind] = ['sale', 'sale']
void sameKinds
const kindsMatch = (k: KeyDateKind): DateKind => k
void kindsMatch

const names = (
  country: HolidayCountry,
  from: string,
  days = 15,
  industry = ''
) =>
  keyDates({ country, from, days, industry }).map(
    (k) => `${k.date} ${k.name} (${k.kind}, from ${k.emailsFrom})`
  )

describe('keyDates (PLN-034)', () => {
  it('counts a date when its emails start inside the window', () => {
    // 1 to 15 December: Christmas (emails from 11 December) is in;
    // Christmas Eve (emails from 21 December) is not yet.
    expect(names('US', '2026-12-01')).toEqual([
      '2026-12-01 Giving Tuesday (sale, from 2026-12-01)',
      '2026-12-04 Hanukkah begins (holiday, from 2026-12-01)',
      '2026-12-14 Free Shipping Day (sale, from 2026-12-09)',
      '2026-12-25 Christmas Day (holiday, from 2026-12-11)'
    ])
  })

  it('leaves out a date whose emails start after the window, and past days', () => {
    // 1 to 5 December: Christmas emails start on 11 December, not yet.
    const short = names('US', '2026-12-01', 5)
    expect(short.some((n) => n.includes('Christmas'))).toBe(false)
    // Cyber Monday (30 November) is over by 1 December.
    expect(short.some((n) => n.includes('Cyber Monday'))).toBe(false)
  })

  it('starts gift days early and big sale days a week ahead', () => {
    const lead = (country: HolidayCountry, from: string, name: string) =>
      keyDates({ country, from, days: 30 }).find((k) => k.name === name)
        ?.leadDays
    expect(lead('US', '2027-04-20', 'Mother’s Day')).toBe(10)
    expect(lead('US', '2027-02-01', 'Valentine’s Day')).toBe(10)
    expect(lead('US', '2026-11-10', 'Black Friday')).toBe(7)
    expect(lead('US', '2026-12-01', 'Christmas Day')).toBe(14)
    expect(lead('US', '2026-11-01', 'Veterans Day')).toBe(3)
  })

  it('adds the end of the financial year where it matters', () => {
    expect(names('AU', '2027-06-10')).toContain(
      '2027-06-30 End of financial year (EOFY) sales (sale, from 2027-06-16)'
    )
    expect(names('NZ', '2027-03-20')).toContain(
      '2027-03-31 End of financial year (event, from 2027-03-24)'
    )
    expect(names('IN', '2027-03-20')).toContain(
      '2027-03-31 End of financial year (event, from 2027-03-24)'
    )
    expect(names('GB', '2027-03-25')).toContain(
      '2027-04-05 End of the tax year (event, from 2027-03-29)'
    )
    expect(
      names('US', '2027-06-10').some((n) => n.includes('financial year'))
    ).toBe(false)
  })

  it('adds shopping days the Holidays page does not list', () => {
    // US: the Saturday after Thanksgiving (26 November 2026).
    expect(names('US', '2026-11-20')).toContain(
      '2026-11-28 Small Business Saturday (sale, from 2026-11-23)'
    )
    // UK: the first Saturday of December.
    expect(names('GB', '2026-11-25')).toContain(
      '2026-12-05 Small Business Saturday (sale, from 2026-11-30)'
    )
    expect(names('INTL', '2026-11-01')).toContain(
      '2026-11-11 Singles’ Day (sale, from 2026-11-06)'
    )
    expect(names('CA', '2027-03-01')).toContain(
      '2027-03-08 International Women’s Day (holiday, from 2027-03-03)'
    )
    expect(names('US', '2026-11-01').some((n) => n.includes('Singles'))).toBe(
      false
    )
  })

  it('matches industry days from the brand’s industry in words', () => {
    const pet = names('US', '2027-08-01', 30, 'Pet supplies')
    expect(pet).toContain(
      '2027-08-08 International Cat Day (event, from 2027-08-05)'
    )
    expect(pet).toContain(
      '2027-08-26 International Dog Day (event, from 2027-08-23)'
    )
    expect(names('US', '2027-04-01', 15, 'Dog treats')).toContain(
      '2027-04-11 National Pet Day (event, from 2027-04-08)'
    )
    // National Pet Day is a US day only.
    expect(
      names('GB', '2027-04-01', 15, 'Dog treats').some((n) =>
        n.includes('National Pet Day')
      )
    ).toBe(false)
    expect(names('AU', '2027-07-01', 15, 'Artisan chocolate')).toContain(
      '2027-07-07 World Chocolate Day (event, from 2027-07-04)'
    )
    expect(names('NZ', '2027-09-25', 15, 'Specialty coffee')).toContain(
      '2027-10-01 International Coffee Day (event, from 2027-09-28)'
    )
    expect(names('INTL', '2027-06-15', 15, 'Yoga wear')).toContain(
      '2027-06-21 International Day of Yoga (event, from 2027-06-18)'
    )
    expect(names('US', '2027-04-15', 15, 'Organic skincare')).toContain(
      '2027-04-22 Earth Day (event, from 2027-04-19)'
    )
    // "Candles" matches nothing (and "category" is not "cat").
    expect(
      keyDates({
        country: 'US',
        from: '2027-08-01',
        days: 30,
        industry: 'Home fragrance category'
      }).filter((k) => k.source === 'industry')
    ).toEqual([])
  })

  it('includes the owner’s own dates, a repeating one on its next date', () => {
    const own = keyDates({
      country: 'US',
      from: '2027-03-01',
      own: [
        {
          name: 'Store birthday',
          date: '2024-03-10',
          kind: 'event',
          repeatsAnnually: true,
          notes: ' 20% off for members '
        },
        {
          name: 'Warehouse closed',
          date: '2027-03-05',
          kind: 'holiday',
          repeatsAnnually: false,
          notes: ''
        },
        {
          name: 'Old sale',
          date: '2026-03-10',
          kind: 'event',
          repeatsAnnually: false,
          notes: ''
        }
      ]
    }).filter((k) => k.source === 'own')
    expect(own).toEqual([
      {
        date: '2027-03-05',
        name: 'Warehouse closed',
        kind: 'holiday',
        source: 'own',
        leadDays: 3,
        emailsFrom: '2027-03-02'
      },
      {
        date: '2027-03-10',
        name: 'Store birthday',
        kind: 'event',
        source: 'own',
        leadDays: 3,
        emailsFrom: '2027-03-07',
        notes: '20% off for members'
      }
    ])
  })

  it('lists one date once, in date order, and refuses a bad window', () => {
    const dates = keyDates({
      country: 'US',
      from: '2027-03-01',
      days: 30,
      own: [
        {
          name: 'st. patrick’s day',
          date: '2027-03-17',
          kind: 'holiday',
          repeatsAnnually: false,
          notes: ''
        }
      ]
    })
    expect(dates.filter((k) => k.date === '2027-03-17')).toHaveLength(1)
    expect([...dates].sort((a, b) => a.date.localeCompare(b.date))).toEqual(
      dates
    )
    expect(keyDates({ country: 'US', from: '1 March' })).toEqual([])
    expect(keyDates({ country: 'US', from: '2027-02-30' })).toEqual([])
    expect(keyDates({ country: 'US', from: '2027-03-01', days: 1e9 })).toEqual(
      []
    )
    expect(keyDates({ country: 'US', from: '2027-03-01', days: 0 })).toEqual([])
  })

  it('never gives a pet brand a chocolate day, and reads words whole', () => {
    const industry = (text: string, from = '2027-07-01', days = 62) =>
      keyDates({ country: 'US', from, days, industry: text })
        .filter((k) => k.source === 'industry')
        .map((k) => k.name)
    expect(industry('Dog treats')).not.toContain('World Chocolate Day')
    expect(industry('Pet treats and chocolate-free snacks')).not.toContain(
      'World Chocolate Day'
    )
    expect(industry('Artisan chocolate')).toEqual(['World Chocolate Day'])
    for (const text of [
      'Puppet theatre',
      'Kitten heels shoes',
      'Cat-eye sunglasses',
      'Hot dogs',
      'Art deco-style lamps',
      'Home fragrance category'
    ])
      expect(industry(text, '2027-04-01')).toEqual([])
    expect(industry('Eco-friendly cleaning', '2027-04-15', 30)).toEqual([
      'Earth Day'
    ])
    expect(industry('Matcha and teaware', '2027-05-15')).toEqual([
      'International Tea Day'
    ])
  })

  it('keeps the owner’s notes when their entry is a calendar date', () => {
    const [black] = keyDates({
      country: 'US',
      from: '2026-11-20',
      own: [
        {
          name: 'black friday',
          date: '2026-11-27',
          kind: 'event',
          repeatsAnnually: false,
          notes: 'Members early access'
        }
      ]
    }).filter((k) => k.date === '2026-11-27')
    expect(black).toEqual({
      date: '2026-11-27',
      name: 'black friday',
      kind: 'sale',
      source: 'own',
      leadDays: 7,
      emailsFrom: '2026-11-20',
      notes: 'Members early access'
    })
    // A plain keyboard apostrophe is the same day.
    expect(
      keyDates({
        country: 'US',
        from: '2027-05-01',
        own: [
          {
            name: "Mother's  Day",
            date: '2027-05-09',
            kind: 'holiday',
            repeatsAnnually: false,
            notes: ''
          }
        ]
      }).filter((k) => k.date === '2027-05-09')
    ).toHaveLength(1)
  })

  it('treats Boxing Day as a sale day where it is a public holiday', () => {
    expect(names('GB', '2026-12-15')).toContain(
      '2026-12-26 Boxing Day (sale, from 2026-12-21)'
    )
  })

  it('plans across the new year', () => {
    expect(names('US', '2026-12-25')).toEqual([
      '2026-12-25 Christmas Day (holiday, from 2026-12-25)',
      '2026-12-26 Boxing Day (sale, from 2026-12-25)',
      '2026-12-31 New Year’s Eve (holiday, from 2026-12-28)',
      '2027-01-01 New Year’s Day (holiday, from 2026-12-29)'
    ])
  })

  it('maps to the planner’s date rows', () => {
    expect(
      toPulseDates(
        keyDates({ country: 'US', from: '2026-11-20', days: 10 }).slice(0, 2)
      )
    ).toEqual([
      { date: '2026-11-26', name: 'Thanksgiving', kind: 'holiday' },
      { date: '2026-11-27', name: 'Black Friday', kind: 'event' }
    ])
  })
})

const tenant = '00000000-0000-4000-8000-000000000101'
function fakeDb(
  holidays: { data: unknown[] | null; error: unknown },
  preference: { data: unknown; error: unknown }
) {
  const asked: string[] = []
  const from = vi.fn((table: string) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: string) => {
        asked.push(`${table}.${column}=${value}`)
        return chain
      }),
      order: vi.fn(() => chain),
      limit: vi.fn(async () => holidays),
      or: vi.fn((filter: string) => {
        asked.push(`${table} or ${filter}`)
        return chain
      }),
      maybeSingle: vi.fn(async () => preference)
    }
    return chain
  })
  return { db: { from } as never, asked }
}

describe('planningKeyDates (PLN-034)', () => {
  it('reads the saved country and the owner’s own dates for this workspace', async () => {
    const { db, asked } = fakeDb(
      {
        data: [
          {
            name: 'Store birthday',
            event_date: '2024-07-01',
            kind: 'event',
            repeats_annually: true,
            notes: null
          }
        ],
        error: null
      },
      { data: { country: 'AU' }, error: null }
    )
    const read = await planningKeyDates(db, {
      tenantId: tenant,
      timezone: 'America/New_York',
      from: '2027-06-20'
    })
    expect(read?.country).toBe('AU')
    expect(read?.countrySource).toBe('saved')
    expect(read?.dates.map((k) => k.name)).toEqual([
      'End of financial year (EOFY) sales',
      'Store birthday'
    ])
    expect(asked).toEqual([
      `holidays.tenant_id=${tenant}`,
      'holidays or repeats_annually.eq.true,event_date.gte.2027-06-20',
      `holiday_preferences.tenant_id=${tenant}`
    ])
  })

  it('passes the window and the industry on', async () => {
    const { db } = fakeDb(
      { data: [], error: null },
      { data: { country: 'US' }, error: null }
    )
    const read = await planningKeyDates(db, {
      tenantId: tenant,
      timezone: 'UTC',
      from: '2027-08-01',
      days: 30,
      industry: 'Pet supplies'
    })
    expect(read?.dates.map((k) => k.name)).toEqual([
      'International Cat Day',
      'International Dog Day'
    ])
    for (const days of [0, 63, 1.5])
      expect(
        await planningKeyDates(db, {
          tenantId: tenant,
          timezone: 'UTC',
          from: '2027-08-01',
          days
        })
      ).toBeNull()
  })

  it('guesses the country from the timezone when none is saved', async () => {
    const { db } = fakeDb(
      { data: [], error: null },
      { data: null, error: null }
    )
    expect(
      await planningKeyDates(db, {
        tenantId: tenant,
        timezone: 'Europe/London',
        from: '2027-03-25'
      })
    ).toMatchObject({ country: 'GB', countrySource: 'guess' })
  })

  it('is null when a read fails or the input is bad, never a guess', async () => {
    const failed = fakeDb(
      { data: null, error: { code: '42501' } },
      { data: null, error: null }
    )
    expect(
      await planningKeyDates(failed.db, {
        tenantId: tenant,
        timezone: 'UTC',
        from: '2027-03-25'
      })
    ).toBeNull()
    const noPreference = fakeDb(
      { data: [], error: null },
      { data: null, error: { code: '42501' } }
    )
    expect(
      await planningKeyDates(noPreference.db, {
        tenantId: tenant,
        timezone: 'UTC',
        from: '2027-03-25'
      })
    ).toBeNull()
    const thrown = {
      from: () => {
        throw new Error('down')
      }
    } as never
    expect(
      await planningKeyDates(thrown, {
        tenantId: tenant,
        timezone: 'UTC',
        from: '2027-03-25'
      })
    ).toBeNull()
    expect(
      await planningKeyDates(
        fakeDb({ data: [], error: null }, { data: null, error: null }).db,
        {
          tenantId: 'not-a-uuid',
          timezone: 'UTC',
          from: '2027-03-25'
        }
      )
    ).toBeNull()
  })
})
