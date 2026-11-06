import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import { saveCampaignDefaults } from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const product = '00000000-0000-4000-8000-000000000301'
function form(values: Record<string, string | string[]>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values))
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v)
  return data
}

let rpc: ReturnType<typeof vi.fn>
beforeEach(() => {
  env.values = { AUTH_MODE: 'supabase' }
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole: 'owner'
  })
  rpc = vi.fn(async () => ({ data: 3, error: null }))
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => vi.clearAllMocks())

describe('saveCampaignDefaults', () => {
  it('saves every tab for the owner’s workspace', async () => {
    const result = await saveCampaignDefaults(
      {},
      form({
        revision: '2',
        featured_product: product,
        sender_name: 'Cedar Lane',
        primary_link: '',
        send_to: ['list_1'],
        dont_send_to: ['seg_9'],
        include_footer: 'on',
        footer_source: 'auto'
      })
    )
    expect(result).toEqual({
      message: 'Defaults saved. New campaigns will start with them.'
    })
    expect(rpc).toHaveBeenCalledWith('save_campaign_defaults', {
      t: tenant,
      expected_revision: 2,
      featured_product_id: product,
      sender_name: 'Cedar Lane',
      primary_link: '',
      send_to: ['list_1'],
      dont_send_to: ['seg_9'],
      include_footer: true,
      footer_source: 'auto'
    })
  })

  it('refuses staff, admins and demo sessions before reading the form', async () => {
    for (const role of ['staff', 'admin']) {
      auth.requireRequestContext.mockResolvedValueOnce({
        tenantId: tenant,
        tenantRole: role
      })
      const data = form({ revision: '0' })
      const read = vi.spyOn(data, 'get')
      expect((await saveCampaignDefaults({}, data)).error).toBe(
        'Only the workspace owner can change campaign defaults.'
      )
      expect(read).not.toHaveBeenCalled()
    }
    env.values = { AUTH_MODE: 'demo' }
    expect(
      (await saveCampaignDefaults({}, form({ revision: '0' }))).error
    ).toMatch(/sign in again/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses bad input without saving', async () => {
    expect(
      (
        await saveCampaignDefaults(
          {},
          form({ revision: '0', primary_link: 'http://x.example' })
        )
      ).error
    ).toMatch(/https:/)
    expect(
      (await saveCampaignDefaults({}, form({ revision: 'x' }))).error
    ).toBe('Reload the page and try again.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains each refusal in plain words', async () => {
    const cases = [
      [{ code: 'PT409' }, /changed in another window/],
      [{ code: '42501' }, /Only the workspace owner/],
      [
        { code: '23514', message: 'Choose a product from your catalogue' },
        /no longer in your catalogue/
      ],
      [{ code: '23514', message: 'Check the audiences' }, /Check the fields/],
      [{ code: 'XX000' }, /Nothing was changed/]
    ] as const
    for (const [error, text] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error })
      expect(
        (await saveCampaignDefaults({}, form({ revision: '1' }))).error
      ).toMatch(text)
    }
  })
})
