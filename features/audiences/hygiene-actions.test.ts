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
import { saveListHygiene } from './hygiene-actions'

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
  rpc = vi.fn(async () => ({ data: 1, error: null }))
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => vi.clearAllMocks())

describe('saveListHygiene', () => {
  it('saves the owner’s days with the revision the page read', async () => {
    expect(
      await saveListHygiene(
        {},
        form({ enabled: 'on', days: '90', revision: '0' })
      )
    ).toEqual({
      message:
        'Saved. New emails leave out people with no clicks, site visits or orders in 90 days.'
    })
    expect(rpc).toHaveBeenCalledWith('set_list_hygiene', {
      t: tenant,
      hygiene_on: true,
      hygiene_days: 90,
      expected_revision: 0
    })
    expect(revalidatePath).toHaveBeenCalledWith('/audiences')
  })

  it('turns hygiene off', async () => {
    expect(
      (
        await saveListHygiene(
          {},
          form({ enabled: 'off', days: '180', revision: '3' })
        )
      ).message
    ).toBe(
      'Saved. New emails leave out only people Klaviyo skips (bounced or suppressed).'
    )
    expect(rpc).toHaveBeenCalledWith(
      'set_list_hygiene',
      expect.objectContaining({ hygiene_on: false, expected_revision: 3 })
    )
  })

  it('refuses staff, admins and the demo without saving', async () => {
    for (const role of ['staff', 'admin', 'manager']) {
      signedInAs(role)
      expect(
        (
          await saveListHygiene(
            {},
            form({ enabled: 'on', days: '90', revision: '0' })
          )
        ).error
      ).toBe('Only the store’s owner can change who is left out.')
    }
    signedInAs('owner')
    env.values = { AUTH_MODE: 'demo' }
    expect(
      (
        await saveListHygiene(
          {},
          form({ enabled: 'on', days: '90', revision: '0' })
        )
      ).error
    ).toMatch(/sign in again/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('checks the form on the server', async () => {
    for (const values of [
      { enabled: 'on', days: '29', revision: '0' },
      { enabled: 'on', days: '731', revision: '0' },
      { enabled: 'on', days: 'ninety', revision: '0' },
      { enabled: 'on', days: '90.5', revision: '0' }
    ])
      expect((await saveListHygiene({}, form(values))).error).toBe(
        'Type a number of days from 30 to 730.'
      )
    for (const values of [
      { enabled: 'yes', days: '90', revision: '0' },
      { enabled: 'on', days: '90', revision: '-1' },
      { enabled: 'on', days: '90' }
    ])
      expect((await saveListHygiene({}, form(values))).error).toBe(
        'Reload the page and try again.'
      )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says what the database refused, in plain words', async () => {
    for (const [code, words] of [
      [
        'PT409',
        'This changed in another window. Reload the page, then try again.'
      ],
      ['42501', 'Only the store’s owner can change who is left out.'],
      ['23514', 'Type a number of days from 30 to 730.'],
      ['XX000', 'We could not save it. Nothing was changed.']
    ]) {
      rpc.mockResolvedValueOnce({ data: null, error: { code } })
      expect(
        (
          await saveListHygiene(
            {},
            form({ enabled: 'on', days: '90', revision: '1' })
          )
        ).error
      ).toBe(words)
    }
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
