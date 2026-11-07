import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import { brandTimezone } from './timezone'

const context = {
  tenantId: '00000000-0000-4000-8000-000000000101',
  timezone: 'Asia/Kathmandu'
}
type Result = { data: unknown; error: { code: string } | null }
function database(tenant: Result, klaviyo: Result) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.maybeSingle = async () => (table === 'tenants' ? tenant : klaviyo)
      return chain
    }
  }
}
beforeEach(() => {
  env.values = { AUTH_MODE: 'supabase' }
})

describe('brandTimezone', () => {
  it('reads where the timezone came from and Klaviyo’s timezone', async () => {
    supabase.createClient.mockResolvedValue(
      database(
        {
          data: { timezone: 'Asia/Kathmandu', timezone_source: 'owner' },
          error: null
        },
        {
          data: { status: 'connected', account_timezone: 'America/New_York' },
          error: null
        }
      )
    )
    const zone = await brandTimezone(context)
    expect(zone).toMatchObject({
      saved: 'Asia/Kathmandu',
      source: 'owner',
      klaviyoTimezone: 'America/New_York'
    })
    expect(zone.options[0]).toBe('UTC')
    expect(zone.options).toContain('Asia/Kathmandu')
  })

  it('sends back the timezone exactly as saved, even one this server does not know', async () => {
    supabase.createClient.mockResolvedValue(
      database(
        {
          data: { timezone: 'Mars/Olympus', timezone_source: 'setup' },
          error: null
        },
        { data: null, error: null }
      )
    )
    // The page shows UTC, but a change must name what is really saved, or
    // the stale-page check would refuse every change.
    const zone = await brandTimezone({ ...context, timezone: 'Mars/Olympus' })
    expect(zone.saved).toBe('Mars/Olympus')
    expect(zone.options).not.toContain('Mars/Olympus')
  })

  it('ignores a disconnected or unknown Klaviyo timezone', async () => {
    supabase.createClient.mockResolvedValue(
      database(
        { data: { timezone_source: 'klaviyo' }, error: null },
        {
          data: {
            status: 'disconnected',
            account_timezone: 'America/New_York'
          },
          error: null
        }
      )
    )
    expect((await brandTimezone(context)).klaviyoTimezone).toBeNull()
    supabase.createClient.mockResolvedValue(
      database(
        { data: { timezone_source: 'klaviyo' }, error: null },
        {
          data: { status: 'connected', account_timezone: 'Mars/Olympus' },
          error: null
        }
      )
    )
    expect((await brandTimezone(context)).klaviyoTimezone).toBeNull()
  })

  it('says unknown when the database update is missing', async () => {
    supabase.createClient.mockResolvedValue(
      database(
        { data: null, error: { code: '42703' } },
        { data: null, error: { code: '42703' } }
      )
    )
    expect(await brandTimezone(context)).toMatchObject({
      saved: 'Asia/Kathmandu',
      source: 'unknown',
      klaviyoTimezone: null
    })
  })

  it('reads nothing in the demo or without a database', async () => {
    env.values = { AUTH_MODE: 'demo' }
    expect((await brandTimezone(context)).source).toBe('unknown')
    expect(supabase.createClient).not.toHaveBeenCalled()
    env.values = { AUTH_MODE: 'supabase' }
    supabase.createClient.mockResolvedValue(null)
    expect((await brandTimezone(context)).source).toBe('unknown')
  })
})
