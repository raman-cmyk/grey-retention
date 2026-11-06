import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import { inviteLimit, teamPage } from './data'

const tenant = '00000000-0000-4000-8000-000000000101'
type Result = { data: unknown; error: { code: string } | null }
let calls: { method: string; args: unknown[] }[]
function database(members: Result, invites: Result) {
  calls = []
  const chain: Record<string, (...args: unknown[]) => unknown> = {}
  for (const method of ['select', 'eq', 'is', 'order'])
    chain[method] = (...args) => {
      calls.push({ method, args })
      return chain
    }
  chain.limit = async (...args) => {
    calls.push({ method: 'limit', args })
    return invites
  }
  return {
    rpc: vi.fn(async () => members),
    from: vi.fn((table: string) => {
      calls.push({ method: 'from', args: [table] })
      return chain
    })
  }
}
const row = {
  id: 'm1',
  profile_id: 'p1',
  name: 'Ana Lee',
  email: 'ana@example.com',
  role: 'admin',
  status: 'active',
  updated_at: '2026-11-06T12:00:00Z',
  is_me: false
}
const openInvite = {
  id: 'i1',
  email: 'new@example.com',
  role: 'staff',
  expires_at: '2026-11-13T12:00:00Z'
}

beforeEach(() => {
  env.values = { AUTH_MODE: 'supabase' }
})

describe('teamPage', () => {
  it('reads members and open invites for a manager', async () => {
    const db = database(
      { data: [row], error: null },
      { data: [openInvite], error: null }
    )
    supabase.createClient.mockResolvedValue(db)
    const page = await teamPage({ tenantId: tenant, tenantRole: 'admin' }, 1)
    expect(page).toEqual({
      canManage: true,
      now: 1,
      state: 'ready',
      members: [
        {
          id: 'm1',
          name: 'Ana Lee',
          email: 'ana@example.com',
          role: 'admin',
          status: 'active',
          updatedAt: '2026-11-06T12:00:00Z',
          isMe: false
        }
      ],
      invites: [
        {
          id: 'i1',
          email: 'new@example.com',
          role: 'staff',
          expiresAt: '2026-11-13T12:00:00Z'
        }
      ]
    })
    expect(db.rpc).toHaveBeenCalledWith('team_members', { t: tenant })
    expect(calls).toContainEqual({ method: 'eq', args: ['tenant_id', tenant] })
    expect(calls).toContainEqual({ method: 'is', args: ['accepted_at', null] })
    expect(calls).toContainEqual({ method: 'is', args: ['revoked_at', null] })
    expect(calls).toContainEqual({ method: 'limit', args: [inviteLimit] })
  })

  it('does not load invites for staff', async () => {
    const db = database({ data: [row], error: null }, { data: [], error: null })
    supabase.createClient.mockResolvedValue(db)
    const page = await teamPage({ tenantId: tenant, tenantRole: 'staff' })
    expect(page).toMatchObject({
      canManage: false,
      state: 'ready',
      invites: []
    })
    expect(db.from).not.toHaveBeenCalled()
  })

  it('keeps the members when only the invites fail', async () => {
    supabase.createClient.mockResolvedValue(
      database(
        { data: [row], error: null },
        { data: null, error: { code: 'XX000' } }
      )
    )
    const page = await teamPage({ tenantId: tenant, tenantRole: 'owner' })
    expect(page).toMatchObject({ state: 'ready', invites: null })
    expect(page.members).toHaveLength(1)
  })

  it('says when the database update is missing or the load failed', async () => {
    supabase.createClient.mockResolvedValue(
      database(
        { data: null, error: { code: 'PGRST202' } },
        { data: [], error: null }
      )
    )
    expect(
      await teamPage({ tenantId: tenant, tenantRole: 'owner' })
    ).toMatchObject({ state: 'missing_command', members: [] })
    supabase.createClient.mockResolvedValue(
      database(
        { data: null, error: { code: '42501' } },
        { data: [], error: null }
      )
    )
    expect(
      await teamPage({ tenantId: tenant, tenantRole: 'owner' })
    ).toMatchObject({ state: 'load_failed' })
  })

  it('reads nothing in the demo or without a database', async () => {
    env.values = { AUTH_MODE: 'demo' }
    expect(
      await teamPage({ tenantId: tenant, tenantRole: 'owner' })
    ).toMatchObject({ state: 'demo' })
    expect(supabase.createClient).not.toHaveBeenCalled()
    env.values = { AUTH_MODE: 'supabase' }
    supabase.createClient.mockResolvedValue(null)
    expect(
      await teamPage({ tenantId: tenant, tenantRole: 'owner' })
    ).toMatchObject({ state: 'no_database' })
  })
})
