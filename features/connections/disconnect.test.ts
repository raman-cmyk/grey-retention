import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)

import { revalidatePath } from 'next/cache'
import { disconnectKlaviyo } from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
let rpc: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('AUTH_MODE', 'supabase')
  vi.mocked(revalidatePath).mockClear()
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole: 'owner'
  })
  rpc = vi.fn(async () => ({ data: null, error: null }))
  supabase.createClient.mockResolvedValue({ rpc })
})

describe('disconnecting Klaviyo', () => {
  it('disconnects the workspace’s Klaviyo for the owner', async () => {
    expect(await disconnectKlaviyo()).toEqual({
      message:
        'Klaviyo is disconnected. Nothing reads it until you connect it again; drafts already in Klaviyo stay there.'
    })
    expect(rpc).toHaveBeenCalledWith('set_fixture_connection', {
      t: tenant,
      provider: 'klaviyo',
      status: 'disconnected'
    })
    expect(revalidatePath).toHaveBeenCalledWith('/connections')
  })

  it.each(['admin', 'staff'])('is refused to %s', async (tenantRole) => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId: tenant,
      tenantRole
    })
    expect(await disconnectKlaviyo()).toEqual({
      error: 'Ask your workspace owner to disconnect Klaviyo.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('asks to sign in again without a session, or in the demo', async () => {
    supabase.createClient.mockResolvedValue(null)
    expect((await disconnectKlaviyo()).error).toBe(
      'Please sign in again to disconnect Klaviyo.'
    )
    supabase.createClient.mockResolvedValue({ rpc })
    vi.stubEnv('AUTH_MODE', 'demo')
    expect((await disconnectKlaviyo()).error).toBe(
      'Please sign in again to disconnect Klaviyo.'
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('changes nothing when the database refuses', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    expect((await disconnectKlaviyo()).error).toBe(
      'Ask your workspace owner to disconnect Klaviyo.'
    )
    rpc.mockResolvedValueOnce({ data: null, error: { code: '08006' } })
    expect((await disconnectKlaviyo()).error).toBe(
      'We could not disconnect Klaviyo. Nothing was changed. Try again.'
    )
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
