import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import { revalidatePath } from 'next/cache'
import { saveBrandTimezone, switchToKlaviyoTimezone } from './timezone-actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
let rpc: ReturnType<typeof vi.fn>
const signedInAs = (tenantRole: string) =>
  auth.requireRequestContext.mockResolvedValue({ tenantId: tenant, tenantRole })
beforeEach(() => {
  env.values = { AUTH_MODE: 'supabase' }
  signedInAs('owner')
  rpc = vi.fn(async () => ({ data: null, error: null }))
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => vi.clearAllMocks())

describe('saveBrandTimezone', () => {
  it('saves a known timezone with the one the page showed', async () => {
    expect(
      await saveBrandTimezone(
        {},
        form({ timezone: 'Europe/London', expected: 'Asia/Kathmandu' })
      )
    ).toEqual({ message: 'Saved. Every date and time now uses Europe/London.' })
    expect(rpc).toHaveBeenCalledWith('set_brand_timezone', {
      t: tenant,
      timezone: 'Europe/London',
      expected: 'Asia/Kathmandu'
    })
    // Every page shows times, so all of them refresh.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('refuses staff, the demo and unknown timezones without saving', async () => {
    signedInAs('staff')
    expect(
      (await saveBrandTimezone({}, form({ timezone: 'UTC', expected: 'UTC' })))
        .error
    ).toMatch(/Only the workspace owner/)
    signedInAs('admin')
    expect(
      (await saveBrandTimezone({}, form({ timezone: 'UTC', expected: 'UTC' })))
        .error
    ).toMatch(/Only the workspace owner/)
    signedInAs('owner')
    env.values = { AUTH_MODE: 'demo' }
    expect(
      (await saveBrandTimezone({}, form({ timezone: 'UTC', expected: 'UTC' })))
        .error
    ).toMatch(/sign in again/)
    env.values = { AUTH_MODE: 'supabase' }
    expect(
      (
        await saveBrandTimezone(
          {},
          form({ timezone: 'Mars/Olympus', expected: 'UTC' })
        )
      ).error
    ).toBe('Choose a timezone from the list.')
    expect((await saveBrandTimezone({}, form({ timezone: 'UTC' }))).error).toBe(
      'Reload the page and try again.'
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains database refusals in plain words', async () => {
    const cases = [
      [{ code: 'PT409' }, /changed in another window/],
      [{ code: '42501' }, /Only the workspace owner/],
      [{ code: '23514' }, /Choose a timezone/],
      [{ code: 'XX000' }, /Nothing was changed/]
    ] as const
    for (const [error, text] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error })
      expect(
        (
          await saveBrandTimezone(
            {},
            form({ timezone: 'UTC', expected: 'Asia/Kathmandu' })
          )
        ).error
      ).toMatch(text)
    }
  })
})

describe('switchToKlaviyoTimezone', () => {
  it('follows Klaviyo, owner only', async () => {
    expect(await switchToKlaviyoTimezone()).toEqual({
      message: 'Saved. The brand timezone now follows Klaviyo.'
    })
    expect(rpc).toHaveBeenCalledWith('use_klaviyo_timezone', { t: tenant })
    signedInAs('staff')
    expect((await switchToKlaviyoTimezone()).error).toMatch(
      /Only the workspace owner/
    )
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('says when Klaviyo has no timezone', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409' } })
    expect((await switchToKlaviyoTimezone()).error).toBe(
      'Klaviyo has not reported a timezone. Reconnect Klaviyo.'
    )
  })
})
