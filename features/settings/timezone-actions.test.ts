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
    ).toEqual({
      message:
        'Saved. The brand timezone is now Europe/London. New plans use it. Campaigns already planned keep their send time.'
    })
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
    expect(
      (
        await saveBrandTimezone(
          {},
          form({ timezone: 'UTC', expected: 'x'.repeat(65) })
        )
      ).error
    ).toBe('Reload the page and try again.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('changes nothing when the timezone is already the brand’s', async () => {
    expect(
      await saveBrandTimezone(
        {},
        form({ timezone: 'Asia/Kathmandu', expected: 'Asia/Kathmandu' })
      )
    ).toEqual({
      message: 'Asia/Kathmandu is already the brand timezone. Nothing changed.'
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('explains database refusals in plain words', async () => {
    const cases = [
      [{ code: 'PT409' }, /changed in another window/],
      [
        { code: 'PT409', message: 'GROS is making a plan' },
        /GROS is making a plan right now\. Try again when the plan is ready/
      ],
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
  it('follows Klaviyo, naming the timezone the page showed, owner only', async () => {
    expect(
      await switchToKlaviyoTimezone(
        {},
        form({ klaviyoTimezone: 'America/New_York' })
      )
    ).toEqual({
      message:
        'Saved. The brand timezone is now Klaviyo’s, America/New_York. New plans use it. Campaigns already planned keep their send time.'
    })
    expect(rpc).toHaveBeenCalledWith('use_klaviyo_timezone', {
      t: tenant,
      expected_zone: 'America/New_York'
    })
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
    signedInAs('staff')
    expect(
      (
        await switchToKlaviyoTimezone(
          {},
          form({ klaviyoTimezone: 'America/New_York' })
        )
      ).error
    ).toMatch(/Only the workspace owner/)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('needs the timezone the page showed', async () => {
    expect((await switchToKlaviyoTimezone({}, form({}))).error).toBe(
      'Reload the page and try again.'
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says why Klaviyo’s timezone could not be used', async () => {
    const cases = [
      [
        'Klaviyo has not reported a timezone',
        'Klaviyo has not reported a timezone. Reconnect Klaviyo.'
      ],
      [
        'Klaviyo reported another timezone',
        'Klaviyo reported another timezone since this page opened. Reload the page to see it.'
      ],
      [
        'GROS is making a plan',
        'GROS is making a plan right now. Try again when the plan is ready. Nothing was changed.'
      ]
    ] as const
    for (const [message, text] of cases) {
      rpc.mockResolvedValueOnce({
        data: null,
        error: { code: 'PT409', message }
      })
      expect(
        (
          await switchToKlaviyoTimezone(
            {},
            form({ klaviyoTimezone: 'America/New_York' })
          )
        ).error
      ).toBe(text)
    }
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
