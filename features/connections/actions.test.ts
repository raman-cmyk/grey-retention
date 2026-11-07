import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)

import { connectKlaviyo, connectShopify } from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const key = 'pk_Ab3dEfg12hi34jk56lm78no90pq12rs1a2b'
const token = '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'

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}

let rpc: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubEnv('ADAPTER_MODE', 'fake')
  vi.stubEnv('AUTH_MODE', 'supabase')
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole: 'owner',
    tenantName: 'Cedar Lane workspace',
    timezone: 'Asia/Kathmandu'
  })
  rpc = vi.fn(async (name: string) =>
    name === 'connect_sample_provider'
      ? { data: 1, error: null }
      : { data: null, error: null }
  )
  supabase.createClient.mockResolvedValue({
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { brand_name: 'Cedar Lane' } })
        })
      })
    })
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

const calls = () => rpc.mock.calls.map(([name]) => name)
const allArgs = () => JSON.stringify(rpc.mock.calls)

describe('connectKlaviyo', () => {
  it('saves the account with a masked hint and never the key', async () => {
    const result = await connectKlaviyo({}, form({ apiKey: key }))
    expect(result).toEqual({
      message:
        'Klaviyo connected with sample data. Nothing was sent to Klaviyo.'
    })
    expect(rpc).toHaveBeenCalledWith('connect_sample_provider', {
      t: tenant,
      provider: 'klaviyo',
      account_label: 'Cedar Lane',
      credential_hint: 'pk_Ab3dE••••••••1a2b',
      template_count: 24,
      // The sample account reports the workspace timezone (UIR-023).
      account_timezone: 'Asia/Kathmandu'
    })
    expect(allArgs()).not.toContain(key)
  })

  it('sends no account timezone when the workspace one is unknown', async () => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId: tenant,
      tenantRole: 'owner',
      tenantName: 'Cedar Lane workspace',
      timezone: 'Mars/Olympus'
    })
    await connectKlaviyo({}, form({ apiKey: key }))
    expect(rpc).toHaveBeenCalledWith(
      'connect_sample_provider',
      expect.objectContaining({ account_timezone: undefined })
    )
  })

  it('refuses staff before looking at the key', async () => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId: tenant,
      tenantRole: 'staff',
      tenantName: 'x'
    })
    expect(await connectKlaviyo({}, form({ apiKey: 'nonsense' }))).toEqual({
      error: 'Ask your workspace owner to connect accounts.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('changes nothing when the new key fails the check', async () => {
    const result = await connectKlaviyo({}, form({ apiKey: 'AbC123' }))
    expect(result.error).toContain('public site ID')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses to run with live providers configured', async () => {
    vi.stubEnv('ADAPTER_MODE', 'real')
    expect(await connectKlaviyo({}, form({ apiKey: key }))).toEqual({
      error: 'Live connections are not switched on yet. Nothing was changed.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses demo sign-in', async () => {
    vi.stubEnv('AUTH_MODE', 'demo')
    expect((await connectKlaviyo({}, form({ apiKey: key }))).error).toContain(
      'sign in again'
    )
  })

  it('falls back to the status-only command on an older database', async () => {
    rpc.mockImplementation(async (name: string) =>
      name === 'connect_sample_provider'
        ? { data: null, error: { code: 'PGRST202' } }
        : { data: null, error: null }
    )
    expect((await connectKlaviyo({}, form({ apiKey: key }))).message).toContain(
      'connected'
    )
    expect(rpc).toHaveBeenLastCalledWith('set_fixture_connection', {
      t: tenant,
      provider: 'klaviyo',
      status: 'connected'
    })
  })

  it('saves without the account timezone on a database without it', async () => {
    rpc.mockImplementation(
      async (name: string, args: Record<string, unknown>) =>
        name === 'connect_sample_provider' && 'account_timezone' in args
          ? { data: null, error: { code: 'PGRST202' } }
          : { data: 1, error: null }
    )
    expect((await connectKlaviyo({}, form({ apiKey: key }))).message).toContain(
      'connected'
    )
    expect(rpc).toHaveBeenLastCalledWith(
      'connect_sample_provider',
      expect.not.objectContaining({ account_timezone: expect.anything() })
    )
    expect(rpc).not.toHaveBeenCalledWith(
      'set_fixture_connection',
      expect.anything()
    )
  })

  it('reports a database refusal without details', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    expect(await connectKlaviyo({}, form({ apiKey: key }))).toEqual({
      error: 'Ask your workspace owner to connect accounts.'
    })
    rpc.mockResolvedValue({ data: null, error: { code: '23514' } })
    expect((await connectKlaviyo({}, form({ apiKey: key }))).error).toContain(
      'Nothing was changed'
    )
  })
})

describe('connectShopify', () => {
  it('saves the store with a masked hint, then queues a sample product sync', async () => {
    const result = await connectShopify(
      {},
      form({
        shopDomain: 'https://Cedar-Lane.myshopify.com/',
        accessToken: token
      })
    )
    expect(result.message).toBe(
      'Shopify connected. Sample products are on their way. Nothing was sent to Shopify.'
    )
    expect(rpc).toHaveBeenCalledWith('connect_sample_provider', {
      t: tenant,
      provider: 'shopify',
      account_label: 'cedar-lane.myshopify.com',
      credential_hint: 'shpat_ab12••••••••ff00',
      shop_domain: 'cedar-lane.myshopify.com'
    })
    expect(calls()).toEqual([
      'connect_sample_provider',
      'enqueue_onboarding_job'
    ])
    expect(allArgs()).not.toContain(token)
  })

  it('refuses an autofilled email address in the domain field', async () => {
    const result = await connectShopify(
      {},
      form({ shopDomain: 'owner@example.com', accessToken: token })
    )
    expect(result.error).toContain('looks like an email address')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains a pasted API secret instead of saving it', async () => {
    const result = await connectShopify(
      {},
      form({
        shopDomain: 'cedar-lane.myshopify.com',
        accessToken: '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'
      })
    )
    expect(result.error).toContain('API secret key')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('tells the owner when the sample product import could not start', async () => {
    rpc.mockImplementation(async (name: string) =>
      name === 'enqueue_onboarding_job'
        ? { data: null, error: { code: '23514' } }
        : { data: 1, error: null }
    )
    const result = await connectShopify(
      {},
      form({ shopDomain: 'cedar-lane.myshopify.com', accessToken: token })
    )
    expect(result.message).toContain('sample product import did not start')
  })

  it('does not queue a sync when saving fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514' } })
    await connectShopify(
      {},
      form({ shopDomain: 'cedar-lane.myshopify.com', accessToken: token })
    )
    expect(calls()).toEqual(['connect_sample_provider'])
  })
})
