// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  offersPage: vi.fn(),
  env: { AUTH_MODE: 'supabase' as string }
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/features/offers/data', () => ({ offersPage: mocks.offersPage }))
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => mocks.env }))

import type { ManagedOffers } from '@/features/offers/source'
import { setupReadModel } from './flow'

const context = {
  kind: 'client' as const,
  userId: 'user-1',
  tenantId: 'tenant-1',
  tenantRole: 'owner' as const,
  tenantName: 'Cedar Lane',
  tenantSlug: 'cedar-lane',
  timezone: 'America/New_York'
}
const offers = (max: number | null): ManagedOffers => ({
  maxDiscountPercent: max,
  grossMarginPercent: null,
  marginFloorPercent: null,
  revision: max === null ? 0 : 1,
  codes: []
})

type Answer = { data: unknown; error: unknown }
type Call = { table: string; filters: unknown[][] }

/** A member's client: each table answers once, and every filter is kept. */
function database(answers: Record<string, Answer>) {
  const calls: Call[] = []
  const db = {
    from(table: string) {
      const call: Call = { table, filters: [] }
      calls.push(call)
      const answer = answers[table] ?? { data: null, error: null }
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => (call.filters.push(['eq', ...args]), chain),
        limit: async () => answer,
        maybeSingle: async () => answer
      }
      return chain
    }
  }
  return { db, calls }
}

const ready = {
  brand_profiles: {
    data: {
      brand_name: 'Cedar Lane',
      domain: 'cedarlane.example',
      revision: 3
    },
    error: null
  },
  onboarding_steps: {
    data: {
      brand_site: 'cedarlane.example',
      rivals_skipped_at: null,
      finished_at: null
    },
    error: null
  },
  competitor_subscriptions: { data: [], error: null },
  workspace_connections: {
    data: {
      status: 'connected',
      mode: 'fixture',
      account_label: 'Sample account',
      credential_hint: 'pk_abc••••wxyz'
    },
    error: null
  },
  klaviyo_credentials: { data: null, error: null }
}

describe('setupReadModel (UI-ONBa)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.env.AUTH_MODE = 'supabase'
    vi.stubEnv('KLAVIYO_MODE', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('reads the steps from the saved records, the sample Klaviyo counting while keys are not live', async () => {
    const { db, calls } = database(ready)
    mocks.createClient.mockResolvedValue(db)
    // A max discount of 0 is set: emails then offer none.
    mocks.offersPage.mockResolvedValue(offers(0))
    const view = await setupReadModel(context)
    expect(view.state).toBe('ready')
    expect(view.owner).toBe(true)
    expect(view.liveKeys).toBe(false)
    expect(view.flow!.steps.map((s) => s.done)).toEqual([
      true,
      true,
      true,
      true,
      false
    ])
    expect(view.flow!.current).toBe(4)
    expect(view.brand).toEqual({
      name: 'Cedar Lane',
      domain: 'cedarlane.example',
      revision: 3
    })
    expect(view.klaviyo!.accountLabel).toBe('Sample account')
    expect(mocks.offersPage).toHaveBeenCalledWith(context)
    for (const call of calls)
      expect(call.filters).toContainEqual(['eq', 'tenant_id', 'tenant-1'])
    expect(
      calls.find((c) => c.table === 'competitor_subscriptions')!.filters
    ).toContainEqual(['eq', 'active', true])
  })

  it('takes a followed brand or the skip for Rivals, and the finish mark', async () => {
    const { db } = database({
      ...ready,
      competitor_subscriptions: { data: [{ id: 's1' }], error: null }
    })
    mocks.createClient.mockResolvedValue(db)
    mocks.offersPage.mockResolvedValue(offers(20))
    expect((await setupReadModel(context)).flow!.allDone).toBe(true)
    const skipped = database({
      ...ready,
      onboarding_steps: {
        data: {
          brand_site: 'cedarlane.example',
          rivals_skipped_at: '2026-11-16T10:00:00Z',
          finished_at: '2026-11-16T10:01:00Z'
        },
        error: null
      }
    })
    mocks.createClient.mockResolvedValue(skipped.db)
    const flow = (await setupReadModel(context)).flow!
    expect(flow.allDone).toBe(true)
    expect(flow.finished).toBe(true)
  })

  it('starts a new workspace at Store, with nothing saved', async () => {
    const { db } = database({})
    mocks.createClient.mockResolvedValue(db)
    mocks.offersPage.mockResolvedValue(offers(null))
    const view = await setupReadModel({ ...context, tenantRole: 'staff' })
    expect(view.state).toBe('ready')
    expect(view.owner).toBe(false)
    expect(view.brand).toBeNull()
    expect(view.flow!.current).toBe(0)
    expect(view.flow!.steps.every((s) => !s.done)).toBe(true)
    expect(view.klaviyo!.status).toBe('none')
  })

  it('needs a real key once live keys are on', async () => {
    vi.stubEnv('KLAVIYO_MODE', 'live')
    const { db } = database(ready)
    mocks.createClient.mockResolvedValue(db)
    mocks.offersPage.mockResolvedValue(offers(20))
    const view = await setupReadModel(context)
    expect(view.liveKeys).toBe(true)
    expect(view.flow!.steps[2]!.done).toBe(false)
    expect(view.flow!.current).toBe(2)
  })

  it('asks only for the session’s own workspace (row rules refuse the rest)', async () => {
    const { db, calls } = database({})
    mocks.createClient.mockResolvedValue(db)
    mocks.offersPage.mockResolvedValue(offers(null))
    const other = { ...context, tenantId: 'tenant-2' }
    await setupReadModel(other)
    expect(mocks.offersPage).toHaveBeenCalledWith(other)
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls)
      expect(call.filters).toContainEqual(['eq', 'tenant_id', 'tenant-2'])
    expect(JSON.stringify(calls)).not.toContain('tenant-1')
  })

  it('is unreadable, never a guess, when a record cannot be read', async () => {
    for (const table of [
      'brand_profiles',
      'onboarding_steps',
      'competitor_subscriptions',
      'workspace_connections'
    ]) {
      const { db } = database({
        ...ready,
        [table]: { data: null, error: { code: '42501' } }
      })
      mocks.createClient.mockResolvedValue(db)
      mocks.offersPage.mockResolvedValue(offers(20))
      const view = await setupReadModel(context)
      expect(view.state, table).toBe('unreadable')
      expect(view.flow).toBeNull()
    }
    const { db } = database(ready)
    mocks.createClient.mockResolvedValue(db)
    // The offers read answers null when it fails.
    mocks.offersPage.mockResolvedValue(null)
    expect((await setupReadModel(context)).state).toBe('unreadable')
    mocks.offersPage.mockRejectedValue(new Error('down'))
    expect((await setupReadModel(context)).state).toBe('unreadable')
  })

  it('reads nothing in the demo', async () => {
    mocks.env.AUTH_MODE = 'demo'
    const view = await setupReadModel(context)
    expect(view.state).toBe('demo')
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
})
