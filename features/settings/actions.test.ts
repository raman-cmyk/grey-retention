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
        send_to: ['LSTnews01'],
        dont_send_to: ['SEGeng030'],
        include_footer: 'on',
        footer_source: 'auto'
      })
    )
    expect(result).toEqual({
      message: 'Defaults saved. The new campaign editor will use them.'
    })
    expect(rpc).toHaveBeenCalledWith('save_campaign_defaults', {
      t: tenant,
      expected_revision: 2,
      featured_product_id: product,
      sender_name: 'Cedar Lane',
      primary_link: '',
      send_to: ['LSTnews01'],
      dont_send_to: ['SEGeng030'],
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

  it('refuses bad input without saving and names the field', async () => {
    expect(
      await saveCampaignDefaults(
        {},
        form({ revision: '0', primary_link: 'http://x.example' })
      )
    ).toEqual({
      error: 'Primary link: use a full address that starts with https://',
      field: 'primary_link'
    })
    expect(
      await saveCampaignDefaults(
        {},
        form({ revision: '0', send_to: 'a', dont_send_to: 'a' })
      )
    ).toEqual({
      error: 'A list or segment cannot be in both Send to and Don’t send to.',
      field: 'dont_send_to'
    })
    expect(await saveCampaignDefaults({}, form({ revision: 'x' }))).toEqual({
      error: 'Reload the page and try again.',
      field: undefined
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains each refusal in plain words, at the right field', async () => {
    const cases = [
      [{ code: 'PT409' }, /changed in another window/, undefined],
      [{ code: '42501' }, /Only the workspace owner/, undefined],
      [
        { code: '23514', message: 'Choose a product from your catalogue' },
        /no longer in your catalogue/,
        'featured_product'
      ],
      [
        {
          code: '23514',
          message: "An audience cannot be in both Send to and Don't send to"
        },
        /cannot be in both/,
        'dont_send_to'
      ],
      [
        { code: '23514', message: 'Check the audiences' },
        /Check the audiences/,
        'send_to'
      ],
      [
        { code: '23514', message: 'Primary link must start with https://' },
        /https:/,
        'primary_link'
      ],
      [
        { code: '23514', message: 'Check the sender name' },
        /one line/,
        'sender_name'
      ],
      [{ code: '23514', message: 'other' }, /Check the fields/, undefined],
      [{ code: 'XX000' }, /Nothing was changed/, undefined]
    ] as const
    for (const [error, text, field] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error })
      const result = await saveCampaignDefaults({}, form({ revision: '1' }))
      expect(result.error).toMatch(text)
      expect(result.field).toBe(field)
    }
  })
})
