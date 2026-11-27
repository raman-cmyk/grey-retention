import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const auth = vi.hoisted(() => ({ resolveRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)

import { GET } from '@/app/api/v1/notifications/route'
import { noticesReadModel } from './read-model'

const tenant = '00000000-0000-4000-8000-000000000101'
const context = (tenantRole = 'owner') => ({
  kind: 'client',
  tenantId: tenant,
  tenantRole,
  timezone: 'UTC'
})

type Answer = { data?: unknown; count?: number; error: unknown }
/** A query that records its filters and answers by its table and shape. */
function client(answers: { list?: Answer; count?: Answer; settings?: Answer }) {
  const filters: unknown[][] = []
  const from = (table: string) => {
    let head = false
    const chain: Record<string, unknown> = {}
    const answer = () =>
      table === 'notification_settings'
        ? (answers.settings ?? { data: null, error: null })
        : head
          ? (answers.count ?? { count: 0, error: null })
          : (answers.list ?? { data: [], error: null })
    Object.assign(chain, {
      select: (_cols: string, options?: { head?: boolean }) => {
        head = options?.head === true
        return chain
      },
      eq: (...a: unknown[]) => (filters.push(['eq', table, ...a]), chain),
      in: (...a: unknown[]) => (filters.push(['in', table, ...a]), chain),
      not: (...a: unknown[]) => (filters.push(['not', table, ...a]), chain),
      is: (...a: unknown[]) => (filters.push(['is', table, ...a]), chain),
      order: () => chain,
      limit: async () => answer(),
      maybeSingle: async () => answer(),
      then: (resolve: (v: unknown) => unknown) => resolve(answer())
    })
    return chain
  }
  return { client: { from }, filters }
}

beforeEach(() => {
  vi.stubEnv('AUTH_MODE', 'supabase')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('noticesReadModel (PICK-107)', () => {
  it('reads the person’s own notices of the three kinds, with the unread count and the email switch', async () => {
    const { client: db, filters } = client({
      list: {
        data: [
          {
            id: 'n1',
            kind: 'plan_ready',
            message: 'Your 15-day plan is ready',
            href: '/plan',
            read_at: null,
            updated_at: '2026-11-27T09:07:00.000Z'
          }
        ],
        error: null
      },
      count: { count: 4, error: null },
      settings: { data: { email_on: true }, error: null }
    })
    supabase.createClient.mockResolvedValue(db)
    const view = await noticesReadModel(context('staff') as never)
    expect(view).toEqual({
      state: 'ready',
      items: [
        {
          id: 'n1',
          kind: 'plan_ready',
          line: 'Your 15-day plan is ready',
          href: '/plan',
          unread: true,
          at: 'Nov 27, 2026 · 9:07 AM'
        }
      ],
      unread: 4,
      emailOn: true,
      owner: false
    })
    expect(filters).toContainEqual(['eq', 'notifications', 'tenant_id', tenant])
    expect(filters).toContainEqual([
      'in',
      'notifications',
      'kind',
      ['plan_ready', 'drafts_ready', 'results_in']
    ])
    expect(filters).toContainEqual(['is', 'notifications', 'read_at', null])
  })

  it('marks a failed read instead of throwing, and keeps nothing in the demo', async () => {
    supabase.createClient.mockResolvedValue(
      client({ count: { error: { code: 'PGRST301' } } }).client
    )
    expect(await noticesReadModel(context() as never)).toEqual({
      state: 'unread'
    })
    supabase.createClient.mockResolvedValue(null)
    expect(await noticesReadModel(context() as never)).toEqual({
      state: 'unread'
    })
    vi.stubEnv('AUTH_MODE', 'demo')
    expect(await noticesReadModel(context() as never)).toEqual({
      state: 'demo'
    })
  })
})

describe('GET /api/v1/notifications', () => {
  it('answers the signed-in person’s unread count, never cached', async () => {
    auth.resolveRequestContext.mockResolvedValue(context())
    supabase.createClient.mockResolvedValue(
      client({ count: { count: 2, error: null } }).client
    )
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: true, data: { unread: 2 } })
  })

  it('refuses a visitor who is not signed in, and says when it cannot read', async () => {
    auth.resolveRequestContext.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    auth.resolveRequestContext.mockResolvedValue(context())
    supabase.createClient.mockResolvedValue(
      client({ count: { error: { code: 'PGRST301' } } }).client
    )
    expect((await GET()).status).toBe(503)
  })
})
