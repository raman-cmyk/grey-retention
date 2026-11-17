// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  readCompetitorSuggestions: vi.fn()
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient
}))
vi.mock('@/lib/env/server', () => ({
  getServerEnvironment: () => ({ AUTH_MODE: 'supabase' })
}))
vi.mock('./suggested-competitors', () => ({
  readCompetitorSuggestions: mocks.readCompetitorSuggestions
}))

import { setupRivals } from './rivals'

const context = {
  kind: 'client' as const,
  userId: 'user-1',
  tenantId: 'tenant-1',
  tenantRole: 'owner' as const,
  tenantName: 'Cedar Lane',
  tenantSlug: 'cedar-lane',
  timezone: 'UTC'
}
type Answer = { data: unknown; error: unknown }

function database(answers: Record<string, Answer>) {
  const calls: { table: string; filters: unknown[][] }[] = []
  const db = {
    from(table: string) {
      const call = { table, filters: [] as unknown[][] }
      calls.push(call)
      const answer = answers[table] ?? { data: null, error: null }
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => (call.filters.push(args), chain),
        order: async () => answer,
        maybeSingle: async () => answer
      }
      return chain
    }
  }
  return { db, calls }
}

const suggestion = (domain: string) => ({
  captureId: domain,
  domain,
  name: domain,
  industry: 'apparel',
  reason: 'Sells apparel like you'
})

describe('setupRivals (UI-ONBe)', () => {
  beforeEach(() => vi.resetAllMocks())

  it('reads the brands followed and the suggestions, only sample brands followable', async () => {
    const { db, calls } = database({
      brand_profiles: { data: { synthetic: true }, error: null },
      competitor_subscriptions: {
        data: [{ label: 'northwind.example' }],
        error: null
      }
    })
    const service = { rpc: vi.fn() }
    mocks.createClient.mockResolvedValue(db)
    mocks.createServiceClient.mockReturnValue(service)
    mocks.readCompetitorSuggestions.mockResolvedValue([
      suggestion('oakmoss.example'),
      suggestion('realbrand.com')
    ])
    const rivals = await setupRivals(context)
    expect(rivals).toMatchObject({
      sample: true,
      following: ['northwind.example'],
      suggestions: [
        { domain: 'oakmoss.example', followable: true },
        { domain: 'realbrand.com', followable: false }
      ]
    })
    // The member's own client first; the server's only for the inbox brands.
    expect(mocks.readCompetitorSuggestions).toHaveBeenCalledWith(
      db,
      'tenant-1',
      { service }
    )
    for (const call of calls)
      expect(call.filters).toContainEqual(['tenant_id', 'tenant-1'])
    expect(
      calls.find((c) => c.table === 'competitor_subscriptions')!.filters
    ).toContainEqual(['active', true])
  })

  it('keeps the step when suggestions cannot be read, and is null when the workspace cannot', async () => {
    mocks.createClient.mockResolvedValue(
      database({
        brand_profiles: { data: { synthetic: false }, error: null },
        competitor_subscriptions: { data: [], error: null }
      }).db
    )
    mocks.createServiceClient.mockReturnValue({})
    mocks.readCompetitorSuggestions.mockRejectedValue(new Error('down'))
    expect(await setupRivals(context)).toEqual({
      sample: false,
      following: [],
      suggestions: null
    })
    mocks.createServiceClient.mockReturnValue(null)
    expect((await setupRivals(context))!.suggestions).toBeNull()
    mocks.createClient.mockResolvedValue(
      database({
        competitor_subscriptions: { data: null, error: { code: '42501' } }
      }).db
    )
    expect(await setupRivals(context)).toBeNull()
  })

  it('asks only for the session’s own workspace', async () => {
    const { db, calls } = database({})
    mocks.createClient.mockResolvedValue(db)
    mocks.createServiceClient.mockReturnValue(null)
    await setupRivals({ ...context, tenantId: 'tenant-2' })
    expect(JSON.stringify(calls)).not.toContain('tenant-1')
    expect(calls.length).toBe(2)
  })
})
