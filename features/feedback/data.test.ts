import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import { feedbackPage, messageLimit, requestLimit } from './data'

const tenant = '00000000-0000-4000-8000-000000000101'
const me = 'p-owner'
type Result = { data: unknown; error: { code: string } | null }
let calls: { table: string; method: string; args: unknown[] }[]
function database(tables: Record<string, Result>) {
  calls = []
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'in', 'order', 'limit'])
        chain[method] = (...args: unknown[]) => {
          calls.push({ table, method, args })
          return chain
        }
      chain.then = (resolve: (value: Result) => void) =>
        resolve(tables[table] ?? { data: [], error: null })
      return chain
    }
  }
}
const ticket = {
  id: 't1',
  subject: 'Duplicate campaign',
  category: 'feature',
  state: 'in_progress',
  created_at: '2026-11-05T10:00:00Z',
  creator_id: me,
  support_messages: [
    {
      id: 'm1',
      actor_id: me,
      body: 'Reuse last week.',
      created_at: '2026-11-05T10:00:00Z'
    },
    {
      id: 'm2',
      actor_id: 'p-sam',
      body: 'Me too.',
      created_at: '2026-11-05T11:00:00Z'
    },
    {
      id: 'm3',
      actor_id: 'p-gone',
      body: 'Old note.',
      created_at: '2026-11-05T12:00:00Z'
    },
    {
      id: 'm4',
      actor_id: 'p-operator',
      body: 'On our list.',
      created_at: '2026-11-06T09:00:00Z'
    }
  ]
}
beforeEach(() => {
  env.values = { AUTH_MODE: 'supabase' }
})

describe('feedbackPage', () => {
  it('splits the details from the replies and labels who wrote them', async () => {
    supabase.createClient.mockResolvedValue(
      database({
        support_tickets: { data: [ticket], error: null },
        // Sam is a member; the deactivated member keeps a membership row;
        // the platform team has none.
        tenant_memberships: {
          data: [
            { profile_id: me },
            { profile_id: 'p-sam' },
            { profile_id: 'p-gone' }
          ],
          error: null
        },
        profiles: {
          data: [{ id: 'p-sam', full_name: ' Sam Lee ' }],
          error: null
        }
      })
    )
    const page = await feedbackPage({ tenantId: tenant, userId: me }, 1)
    expect(page.state).toBe('ready')
    expect(page.team).toBe('Grey Retention team')
    expect(page.requests).toEqual([
      {
        id: 't1',
        subject: 'Duplicate campaign',
        category: 'feature',
        status: 'planned',
        createdAt: '2026-11-05T10:00:00Z',
        by: 'You',
        details: 'Reuse last week.',
        replies: [
          {
            id: 'm2',
            author: 'Sam Lee',
            fromTeam: false,
            body: 'Me too.',
            createdAt: '2026-11-05T11:00:00Z'
          },
          {
            id: 'm3',
            author: 'A teammate',
            fromTeam: false,
            body: 'Old note.',
            createdAt: '2026-11-05T12:00:00Z'
          },
          {
            id: 'm4',
            author: 'Grey Retention team',
            fromTeam: true,
            body: 'On our list.',
            createdAt: '2026-11-06T09:00:00Z'
          }
        ]
      }
    ])
  })

  it('reads this workspace’s feedback only, with limits', async () => {
    supabase.createClient.mockResolvedValue(
      database({ support_tickets: { data: [ticket], error: null } })
    )
    await feedbackPage({ tenantId: tenant, userId: me })
    expect(calls).toContainEqual({
      table: 'support_tickets',
      method: 'eq',
      args: ['tenant_id', tenant]
    })
    expect(calls).toContainEqual({
      table: 'support_tickets',
      method: 'eq',
      args: ['kind', 'feedback']
    })
    expect(calls).toContainEqual({
      table: 'support_tickets',
      method: 'limit',
      args: [requestLimit]
    })
    expect(calls).toContainEqual({
      table: 'support_tickets',
      method: 'limit',
      args: [messageLimit, { referencedTable: 'support_messages' }]
    })
    expect(calls).toContainEqual({
      table: 'tenant_memberships',
      method: 'eq',
      args: ['tenant_id', tenant]
    })
    // Names only for the people who wrote.
    expect(calls).toContainEqual({
      table: 'profiles',
      method: 'in',
      args: ['id', [me, 'p-sam', 'p-gone', 'p-operator']]
    })
  })

  it('shows an empty list without further reads', async () => {
    supabase.createClient.mockResolvedValue(
      database({ support_tickets: { data: [], error: null } })
    )
    const page = await feedbackPage({ tenantId: tenant, userId: me })
    expect(page).toMatchObject({ state: 'ready', requests: [] })
    expect(calls.some((c) => c.table !== 'support_tickets')).toBe(false)
  })

  it('says when the database update is missing or a read failed', async () => {
    supabase.createClient.mockResolvedValue(
      database({ support_tickets: { data: null, error: { code: '42703' } } })
    )
    expect((await feedbackPage({ tenantId: tenant, userId: me })).state).toBe(
      'missing_column'
    )
    supabase.createClient.mockResolvedValue(
      database({ support_tickets: { data: null, error: { code: 'XX000' } } })
    )
    expect((await feedbackPage({ tenantId: tenant, userId: me })).state).toBe(
      'load_failed'
    )
    supabase.createClient.mockResolvedValue(
      database({
        support_tickets: { data: [ticket], error: null },
        tenant_memberships: { data: null, error: { code: 'XX000' } }
      })
    )
    // Without members we cannot tell team replies apart, so we say so.
    expect((await feedbackPage({ tenantId: tenant, userId: me })).state).toBe(
      'load_failed'
    )
  })

  it('reads nothing in the demo or without a database', async () => {
    env.values = { AUTH_MODE: 'demo' }
    expect((await feedbackPage({ tenantId: tenant, userId: me })).state).toBe(
      'demo'
    )
    expect(supabase.createClient).not.toHaveBeenCalled()
    env.values = { AUTH_MODE: 'supabase' }
    supabase.createClient.mockResolvedValue(null)
    expect((await feedbackPage({ tenantId: tenant, userId: me })).state).toBe(
      'no_database'
    )
  })
})
