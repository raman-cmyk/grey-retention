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
        { data: { timezone_source: 'owner' }, error: null },
        {
          data: { status: 'connected', account_timezone: 'America/New_York' },
          error: null
        }
      )
    )
    expect(await brandTimezone(context)).toEqual({
      timezone: 'Asia/Kathmandu',
      source: 'owner',
      klaviyoTimezone: 'America/New_York'
    })
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

  it('says unknown when the database update is missing, and falls back to UTC', async () => {
    supabase.createClient.mockResolvedValue(
      database(
        { data: null, error: { code: '42703' } },
        { data: null, error: { code: '42703' } }
      )
    )
    expect(
      await brandTimezone({ ...context, timezone: 'Mars/Olympus' })
    ).toEqual({
      timezone: 'UTC',
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
