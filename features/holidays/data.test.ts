import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import { holidayLimit, holidaysPage } from './data'

const tenant = '00000000-0000-4000-8000-000000000101'
// 2026-11-06 20:00 UTC is already 7 November in Kathmandu.
const now = Date.parse('2026-11-06T20:00:00Z')
const context = { tenantId: tenant, timezone: 'Asia/Kathmandu' }
type Result = { data: unknown; error: { code: string } | null }

let calls: { table: string; method: string; args: unknown[] }[]
function database(rows: Result, preference: Result) {
  calls = []
  return {
    from(table: string) {
      const chain: Record<string, (...args: unknown[]) => unknown> = {}
      for (const method of ['select', 'eq', 'order'])
        chain[method] = (...args) => {
          calls.push({ table, method, args })
          return chain
        }
      chain.limit = async (...args) => {
        calls.push({ table, method: 'limit', args })
        return rows
      }
      chain.maybeSingle = async () => preference
      return chain
    }
  }
}
const row = {
  id: '00000000-0000-4000-8000-000000000777',
  name: 'Brand anniversary',
  event_date: '2020-03-14',
  kind: 'holiday',
  repeats_annually: true,
  notes: '',
  revision: 1
}

beforeEach(() => {
  env.values = { AUTH_MODE: 'supabase' }
})

describe('holidaysPage', () => {
  it('reads this workspace’s entries and saved country', async () => {
    supabase.createClient.mockResolvedValue(
      database(
        { data: [row], error: null },
        { data: { country: 'AU' }, error: null }
      )
    )
    const page = await holidaysPage(context, now)
    expect(page).toMatchObject({
      today: '2026-11-07',
      managedBy: 'Grey Retention',
      country: 'AU',
      countrySource: 'saved',
      state: 'ready'
    })
    expect(page.own?.map((e) => `${e.name} ${e.nextDate}`)).toEqual([
      'Brand anniversary 2027-03-14'
    ])
    expect(page.platform.length).toBeGreaterThan(0)
    expect(calls).toContainEqual({
      table: 'holidays',
      method: 'eq',
      args: ['tenant_id', tenant]
    })
    expect(calls).toContainEqual({
      table: 'holidays',
      method: 'limit',
      args: [holidayLimit]
    })
    expect(calls).toContainEqual({
      table: 'holiday_preferences',
      method: 'eq',
      args: ['tenant_id', tenant]
    })
  })

  it('guesses the country from the timezone until the owner picks one', async () => {
    supabase.createClient.mockResolvedValue(
      database({ data: [], error: null }, { data: null, error: null })
    )
    const page = await holidaysPage(
      { tenantId: tenant, timezone: 'Europe/London' },
      now
    )
    expect(page).toMatchObject({ country: 'GB', countrySource: 'guess' })
  })

  it('does not call it a guess when the saved country cannot be read', async () => {
    supabase.createClient.mockResolvedValue(
      database(
        { data: [row], error: null },
        { data: null, error: { code: 'XX000' } }
      )
    )
    const page = await holidaysPage(context, now)
    expect(page).toMatchObject({ country: 'INTL', countrySource: 'unknown' })
    expect(page.own).toHaveLength(1)
  })

  it('says when the table is missing or the load failed', async () => {
    supabase.createClient.mockResolvedValue(
      database(
        { data: null, error: { code: '42P01' } },
        {
          data: null,
          error: null
        }
      )
    )
    expect(await holidaysPage(context, now)).toMatchObject({
      state: 'missing_table',
      own: null
    })
    supabase.createClient.mockResolvedValue(
      database(
        { data: null, error: { code: 'XX000' } },
        {
          data: null,
          error: null
        }
      )
    )
    const failed = await holidaysPage(context, now)
    expect(failed).toMatchObject({ state: 'load_failed', own: null })
    // The platform list still shows.
    expect(failed.platform.length).toBeGreaterThan(0)
  })

  it('reads nothing in the demo or without a database', async () => {
    env.values = { AUTH_MODE: 'demo' }
    expect(await holidaysPage(context, now)).toMatchObject({
      state: 'demo',
      own: null
    })
    expect(supabase.createClient).not.toHaveBeenCalled()
    env.values = { AUTH_MODE: 'supabase' }
    supabase.createClient.mockResolvedValue(null)
    expect(await holidaysPage(context, now)).toMatchObject({
      state: 'no_database'
    })
  })
})
