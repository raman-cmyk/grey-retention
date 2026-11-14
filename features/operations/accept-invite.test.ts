// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const set = vi.fn()
class Redirected extends Error {}
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set }) }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to)
  }
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc })
}))
vi.mock('@/features/auth/application/request-context', () => ({
  activeTenantCookieName: 'active_tenant',
  requireRequestContext: vi.fn()
}))

import { acceptInvite } from './actions'

const invite = '00000000-0000-4000-8000-0000000000a1'
const workspace = '00000000-0000-4000-8000-000000000101'
const form = (id = invite) => {
  const data = new FormData()
  data.set('id', id)
  return data
}

beforeEach(() => {
  rpc.mockReset()
  set.mockReset()
})

describe('accepting a team invite', () => {
  it('opens the workspace once accepted', async () => {
    rpc.mockImplementation(async (name: string) =>
      name === 'accept_team_invite'
        ? { data: workspace, error: null }
        : { data: [{ tenant_id: workspace }], error: null }
    )
    await expect(acceptInvite({}, form())).rejects.toBeInstanceOf(Redirected)
    expect(rpc).toHaveBeenCalledWith('accept_team_invite', { invite })
    expect(set).toHaveBeenCalledWith(
      'active_tenant',
      workspace,
      expect.objectContaining({ httpOnly: true })
    )
  })

  it('says an expired or cancelled invite needs a new one', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'Invite revoked or expired' }
    })
    expect(await acceptInvite({}, form())).toEqual({
      error:
        'This invitation has expired or was cancelled. Ask the workspace for a new one.'
    })
    expect(set).not.toHaveBeenCalled()
  })

  it('tells someone the workspace removed to ask to be reactivated', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PT409', message: 'Ask the workspace to reactivate you' }
    })
    expect(await acceptInvite({}, form())).toEqual({
      error: 'Ask the workspace to reactivate you.'
    })
  })

  it('does not open a workspace that no longer lets them in', async () => {
    // The same invite, accepted before, answers with its workspace again.
    rpc.mockImplementation(async (name: string) =>
      name === 'accept_team_invite'
        ? { data: workspace, error: null }
        : { data: [], error: null }
    )
    expect(await acceptInvite({}, form())).toEqual({
      error: 'Ask the workspace to reactivate you.'
    })
    expect(rpc).toHaveBeenCalledWith('resolve_client_context', {
      requested_tenant_id: workspace
    })
    expect(set).not.toHaveBeenCalled()
  })

  it('keeps the usual answer for another address or a closed workspace', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    expect(await acceptInvite({}, form())).toEqual({
      error: 'Invitation is unavailable for your verified account email.'
    })
    expect(await acceptInvite({}, form('not-an-id'))).toEqual({
      error: 'Invalid invitation.'
    })
  })
})
