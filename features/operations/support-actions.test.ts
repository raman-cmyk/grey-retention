// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn() }) }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc })
}))
vi.mock('@/features/auth/application/request-context', () => ({
  activeTenantCookieName: 'active_tenant',
  ...auth
}))

import { operationAction } from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const ticket = '00000000-0000-4000-8000-0000000000b1'
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
const ask = {
  surface: 'client',
  kind: 'open_ticket',
  ticketKind: 'support',
  subject: 'Klaviyo drafts',
  body: 'Where do my drafts go?'
}
const reply = {
  surface: 'client',
  kind: 'reply_ticket',
  id: ticket,
  tenant,
  revision: '2',
  state: 'open',
  body: 'Thanks, found them.'
}

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: null, error: null })
  auth.requireRequestContext.mockResolvedValue({
    kind: 'client',
    tenantId: tenant,
    tenantRole: 'staff'
  })
})

describe('support on Settings (UI-SETd)', () => {
  it('sends a question and a reply for the signed-in workspace, in plain words', async () => {
    expect(await operationAction({}, form(ask))).toEqual({
      message: 'Sent to support. Their reply shows here.'
    })
    expect(rpc).toHaveBeenLastCalledWith('open_support_ticket', {
      t: tenant,
      kind: 'support',
      subject: 'Klaviyo drafts',
      body: 'Where do my drafts go?'
    })
    expect(
      await operationAction({}, form({ ...reply, tenant: ticket }))
    ).toEqual({ message: 'Reply sent.' })
    // A member's reply always goes to their own workspace.
    expect(rpc).toHaveBeenLastCalledWith('reply_support', {
      t: tenant,
      ticket,
      expected_revision: 2,
      body: 'Thanks, found them.',
      state: 'open'
    })
  })

  it('says what to fix, and refuses in plain words', async () => {
    expect(
      (await operationAction({}, form({ ...ask, subject: 'K' }))).error
    ).toBe('Write a subject of at least 2 characters, and your question.')
    expect(
      (await operationAction({}, form({ ...reply, body: ' ' }))).error
    ).toBe('Write your reply first.')
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })
    expect((await operationAction({}, form(ask))).error).toBe(
      'We could not send this. Nothing was saved. Try again.'
    )
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    expect((await operationAction({}, form(reply))).error).toBe(
      'This ticket is not open to you any more. Reload the page.'
    )
  })
})
