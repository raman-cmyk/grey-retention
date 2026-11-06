import 'server-only'
import { defaultBrandPresentation } from '@/lib/branding/presentation'
import { validTimezone } from '@/lib/brand-time'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { localDate, ownEntries, type OwnEntry } from './entries'
import {
  countryFromTimezone,
  isHolidayCountry,
  platformHolidays,
  type HolidayCountry,
  type PlatformHoliday
} from './platform'

export type HolidaysPage = {
  /** The brand's today (YYYY-MM-DD). */
  today: string
  /** Who manages the platform list (white-label: the product's name). */
  managedBy: string
  country: HolidayCountry
  /** 'guess' when the owner has not chosen yet (from the timezone). */
  countrySource: 'saved' | 'guess'
  platform: PlatformHoliday[]
  own: OwnEntry[] | null
  state: 'ready' | 'missing_table' | 'load_failed' | 'demo' | 'no_database'
}

const missingColumn = new Set(['PGRST204', 'PGRST205', '42P01', '42703'])

/** What one workspace's Holidays & Events page shows. */
export async function holidaysPage(
  context: { tenantId: string; timezone: string },
  now = Date.now()
): Promise<HolidaysPage> {
  const timezone = validTimezone(context.timezone)
  const today = localDate(timezone, new Date(now))
  const guess = countryFromTimezone(timezone)
  const base = {
    today,
    managedBy: defaultBrandPresentation.productName,
    country: guess,
    countrySource: 'guess' as const
  }
  const page = (country: HolidayCountry, rest: Partial<HolidaysPage>) => ({
    ...base,
    ...rest,
    country,
    platform: platformHolidays({ country, from: today }),
    own: rest.own ?? null,
    state: rest.state ?? 'ready'
  })
  if (getServerEnvironment().AUTH_MODE === 'demo')
    return page(guess, { state: 'demo' })
  const db = await createClient()
  if (!db) return page(guess, { state: 'no_database' })
  const [rows, preference] = await Promise.all([
    db
      .from('holidays')
      .select('id,name,event_date,kind,repeats_annually,notes,revision')
      .eq('tenant_id', context.tenantId),
    db
      .from('holiday_preferences')
      .select('country')
      .eq('tenant_id', context.tenantId)
      .maybeSingle()
  ])
  const saved = preference.data?.country
  const country = saved && isHolidayCountry(saved) ? saved : guess
  if (rows.error)
    return page(country, {
      state: missingColumn.has(rows.error.code)
        ? 'missing_table'
        : 'load_failed'
    })
  return page(country, {
    countrySource: saved ? 'saved' : 'guess',
    own: ownEntries(rows.data ?? [], today)
  })
}
