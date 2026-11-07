import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import { eventLimit, inviteLimit, teamPage } from './data'

const tenant = '00000000-0000-4000-8000-000000000101'
type Result = { data: unknown; error: { code: string } | null }
let calls: { table: string; method: string; args: unknown[] }[]
const none: Result = { data: [], error: null }
function database(
  members: Result,
  invites: Result,
  events: Result = none,
  inviteEmails: Result = none
) {
  calls = []
  return {
    rpc: vi.fn(async () => members),
    from: vi.fn((table: string) => {
      let byId = false
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'is', 'order', 'limit', 'in'])
        chain[method] = (...args: unknown[]) => {
          calls.push({ table, method, args })
          if (method === 'in' && args[0] === 'id') byId = true
          return chain
        }
      chain.then = (resolve: (value: Result) => void) =>
        resolve(
          table === 'workspace_events' ? events : byId ? inviteEmails : invites
        )
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
const me = {
  ...row,
  id: 'm0',
  profile_id: 'p0',
  name: 'Olive',
  role: 'owner',
  is_me: true
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
      events: [],
      members: [
        {
          id: 'm1',
          profileId: 'p1',
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
    expect(calls).toContainEqual({
      table: 'tenant_invites',
      method: 'eq',
      args: ['tenant_id', tenant]
    })
    expect(calls).toContainEqual({
      table: 'tenant_invites',
      method: 'is',
      args: ['accepted_at', null]
    })
    expect(calls).toContainEqual({
      table: 'tenant_invites',
      method: 'is',
      args: ['revoked_at', null]
    })
    expect(calls).toContainEqual({
      table: 'tenant_invites',
      method: 'limit',
      args: [inviteLimit]
    })
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

  it('explains recent team changes for managers, newest first', async () => {
    supabase.createClient.mockResolvedValue(
      database(
        { data: [me, row], error: null },
        { data: [], error: null },
        {
          data: [
            {
              id: 'e2',
              kind: 'invitation_revoked',
              entity_id: 'i9',
              actor_id: 'p1',
              detail: { reason: 'expired' },
              created_at: '2026-11-06T11:00:00Z'
            },
            {
              id: 'e1',
              kind: 'membership_update',
              entity_id: 'm1',
              actor_id: 'p0',
              detail: {
                beforeRole: 'staff',
                afterRole: 'admin',
                beforeStatus: 'active',
                afterStatus: 'active'
              },
              created_at: '2026-11-06T10:00:00Z'
            },
            {
              id: 'e0',
              kind: 'membership_update',
              entity_id: 'm1',
              actor_id: 'gone',
              detail: { beforeStatus: 'active', afterStatus: 'active' },
              created_at: '2026-11-06T09:00:00Z'
            }
          ],
          error: null
        },
        { data: [{ id: 'i9', email: 'late@example.com' }], error: null }
      )
    )
    const page = await teamPage({ tenantId: tenant, tenantRole: 'owner' })
    expect(page.events).toEqual([
      {
        id: 'e2',
        text: 'Expired invite to late@example.com cancelled',
        by: 'Ana Lee',
        at: '2026-11-06T11:00:00Z'
      },
      {
        id: 'e1',
        text: 'Ana Lee is now a Manager',
        by: 'you',
        at: '2026-11-06T10:00:00Z'
      }
    ])
    expect(calls).toContainEqual({
      table: 'workspace_events',
      method: 'limit',
      args: [eventLimit]
    })
    expect(calls).toContainEqual({
      table: 'tenant_invites',
      method: 'in',
      args: ['id', ['i9']]
    })
  })

  it('keeps the page when only the changes fail to load', async () => {
    supabase.createClient.mockResolvedValue(
      database(
        { data: [row], error: null },
        { data: [], error: null },
        { data: null, error: { code: 'XX000' } }
      )
    )
    const page = await teamPage({ tenantId: tenant, tenantRole: 'admin' })
    expect(page).toMatchObject({ state: 'ready', events: null })
  })
})
