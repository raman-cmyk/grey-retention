import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)

import { revalidatePath } from 'next/cache'
import { recordedTransport } from '@/lib/providers/klaviyo/recorded'
import * as actions from './actions'
import { connectKlaviyo } from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const key = 'pk_Ab3dEfg12hi34jk56lm78no90pq12rs1a2b'

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
      account_timezone: 'Asia/Kathmandu',
      // ...and what business it belongs to (UIR-021).
      account_website: undefined,
      account_currency: 'USD',
      account_country: 'US'
    })
    expect(allArgs()).not.toContain(key)
  })

  it('connects ANOTHER brand’s sample account for keys ending in 0000', async () => {
    await connectKlaviyo(
      {},
      form({ apiKey: 'pk_Ab3dEfg12hi34jk56lm78no90pq12rs0000' })
    )
    expect(rpc).toHaveBeenCalledWith(
      'connect_sample_provider',
      expect.objectContaining({
        account_label: 'Northwind Outdoor (sample)',
        account_website: 'https://northwind-outdoor.example',
        account_currency: 'EUR',
        account_country: 'DE',
        // Trying the other brand's sample never moves the brand timezone.
        account_timezone: 'Asia/Kathmandu'
      })
    )
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

  it('drops the newest arguments first on an older database', async () => {
    const known = ['t', 'provider', 'account_label', 'credential_hint']
    // A database with the timezone update but not the account facts.
    rpc.mockImplementation(
      async (name: string, args: Record<string, unknown>) =>
        name === 'connect_sample_provider' &&
        Object.keys(args).some(
          (key) =>
            ![
              ...known,
              'shop_domain',
              'template_count',
              'account_timezone'
            ].includes(key)
        )
          ? { data: null, error: { code: 'PGRST202' } }
          : { data: 1, error: null }
    )
    expect((await connectKlaviyo({}, form({ apiKey: key }))).message).toContain(
      'connected'
    )
    const calls = rpc.mock.calls.filter(
      ([name]) => name === 'connect_sample_provider'
    )
    expect(calls).toHaveLength(2)
    expect(calls[1][1]).toHaveProperty('account_timezone')
    expect(calls[1][1]).not.toHaveProperty('account_website')
    expect(calls[1][1]).not.toHaveProperty('account_currency')
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

describe('Shopify (v2 is Klaviyo only)', () => {
  it('has no Shopify connect action any more', () => {
    expect('connectShopify' in actions).toBe(false)
  })
})

describe('connectKlaviyo with live Klaviyo (KLV-001)', () => {
  it('never calls Klaviyo in sample mode, even on a hosted database', async () => {
    vi.stubEnv(
      'NEXT_PUBLIC_SUPABASE_URL',
      'https://example-project.supabase.co'
    )
    vi.stubEnv('KLAVIYO_MODE', '')
    const network = vi.fn()
    vi.stubGlobal('fetch', network)
    expect((await connectKlaviyo({}, form({ apiKey: key }))).message).toMatch(
      /sample data/
    )
    expect(network).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('in live mode, refuses staff, demo sign-in and a bad key before any call', async () => {
    vi.stubEnv('KLAVIYO_MODE', 'live')
    const network = vi.fn()
    vi.stubGlobal('fetch', network)
    expect(
      (await connectKlaviyo({}, form({ apiKey: 'AbC123' }))).error
    ).toContain('public site ID')
    vi.stubEnv('AUTH_MODE', 'demo')
    expect((await connectKlaviyo({}, form({ apiKey: key }))).error).toMatch(
      /sign in again/
    )
    vi.stubEnv('AUTH_MODE', 'supabase')
    auth.requireRequestContext.mockResolvedValue({
      tenantId: tenant,
      tenantRole: 'staff',
      tenantName: 'x'
    })
    expect(await connectKlaviyo({}, form({ apiKey: key }))).toEqual({
      error: 'Ask your workspace owner to connect accounts.'
    })
    expect(network).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  /** fetch answering like Klaviyo, from the recordings. */
  const klaviyo = (answer = recordedTransport()) => {
    const sent: { url: string; init: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, init })
        const r = await answer({
          method: 'GET',
          url,
          headers: {},
          timeoutMs: 0
        })
        return new Response(r.body, { status: r.status, headers: r.headers })
      })
    )
    return sent
  }

  it('in live mode, checks an owner key with Klaviyo and saves it for the workspace signed in', async () => {
    vi.stubEnv('KLAVIYO_MODE', 'live')
    const sent = klaviyo()
    rpc.mockImplementation(async () => ({ data: 1, error: null }))
    const result = await connectKlaviyo(
      {},
      form({ apiKey: `  ${key}  `, t: 'another-workspace' })
    )
    expect(result.message).toMatch(/^Klaviyo connected: Cedar Goods\./)
    // One read-only GET per scope, only to Klaviyo, never following a redirect.
    expect(sent).toHaveLength(10)
    for (const { url, init } of sent) {
      expect(url.startsWith('https://a.klaviyo.com/api/')).toBe(true)
      expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
    }
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      'begin_klaviyo_key_check',
      'connect_klaviyo_live'
    ])
    // The workspace comes from the sign-in, never from the form; the key is trimmed.
    expect(rpc.mock.calls[1]![1]).toMatchObject({ t: tenant, api_key: key })
    expect(revalidatePath).toHaveBeenCalledWith('/connections')
    vi.unstubAllGlobals()
  })

  it('in live mode, waits for no rate limit and refreshes nothing when a key is refused', async () => {
    vi.stubEnv('KLAVIYO_MODE', 'live')
    const sent = klaviyo(
      recordedTransport({
        all: { status: 429, headers: { 'retry-after': '1' }, body: '{}' }
      })
    )
    rpc.mockImplementation(async () => ({ data: 1, error: null }))
    expect((await connectKlaviyo({}, form({ apiKey: key }))).error).toMatch(
      /slow down/
    )
    expect(sent).toHaveLength(10)
    expect(rpc).not.toHaveBeenCalledWith(
      'connect_klaviyo_live',
      expect.anything()
    )
    expect(revalidatePath).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
