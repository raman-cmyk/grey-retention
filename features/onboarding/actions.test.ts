// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/integrations/worker', () => ({ runFixtureJobs: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)

import { onboardingAction } from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
const status = (provider: string, value: string) =>
  form({ kind: 'connection', provider, status: value, folder: '' })

let rpc: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubEnv('AUTH_MODE', 'supabase')
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole: 'owner',
    tenantName: 'Cedar Lane workspace'
  })
  rpc = vi.fn(async () => ({ data: 1, error: null }))
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('onboardingAction with live Klaviyo (KLV-001)', () => {
  it('never sets a sample status on Klaviyo, but still lets the owner disconnect it', async () => {
    vi.stubEnv('KLAVIYO_MODE', 'live')
    for (const value of ['connected', 'expired', 'error'])
      expect(
        (await onboardingAction({}, status('klaviyo', value))).error,
        value
      ).toMatch(/sample status cannot be changed/)
    expect(rpc).not.toHaveBeenCalled()
    await onboardingAction({}, status('klaviyo', 'disconnected'))
    expect(rpc).toHaveBeenCalledWith(
      'set_fixture_connection',
      expect.objectContaining({ t: tenant, status: 'disconnected' })
    )
  })

  it('keeps the sample tools for the other connections, and for Klaviyo in sample mode', async () => {
    vi.stubEnv('KLAVIYO_MODE', 'live')
    await onboardingAction({}, status('drive', 'connected'))
    vi.stubEnv('KLAVIYO_MODE', '')
    await onboardingAction({}, status('klaviyo', 'expired'))
    expect(rpc.mock.calls.map((c) => c[1].provider)).toEqual([
      'drive',
      'klaviyo'
    ])
  })
})
