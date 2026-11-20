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
import { websiteSavedAt } from './brand-found'
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
        is: (...args: unknown[]) => (call.filters.push(['is', ...args]), chain),
        order: () => chain,
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
    // The workspace has its onboarding row.
    expect(view.flow!.tracked).toBe(true)
    expect(view.brand).toEqual({
      name: 'Cedar Lane',
      domain: 'cedarlane.example',
      revision: 3
    })
    expect(view.klaviyo!.accountLabel).toBe('Sample account')
    expect(mocks.offersPage).toHaveBeenCalledWith(context)
    for (const call of calls)
      expect(call.filters).toContainEqual([
        'eq',
        call.table === 'tenants' ? 'id' : 'tenant_id',
        'tenant-1'
      ])
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
    // No row: a workspace from before onboarding.
    expect(view.flow!.tracked).toBe(false)
    expect(view.klaviyo!.status).toBe('none')
  })

  it('does not count an expired Klaviyo connection', async () => {
    const { db } = database({
      ...ready,
      workspace_connections: {
        data: { ...ready.workspace_connections.data, status: 'expired' },
        error: null
      }
    })
    mocks.createClient.mockResolvedValue(db)
    mocks.offersPage.mockResolvedValue(offers(20))
    const flow = (await setupReadModel(context)).flow!
    expect(flow.steps[2]!.done).toBe(false)
    expect(flow.current).toBe(2)
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

  it('reads what was found for the saved website, and nothing made up', async () => {
    const { db, calls } = database({
      ...ready,
      brand_kits: {
        data: {
          colors: ['#1F3A2B', 'red; x', '#abc'],
          fonts: ['Lora', '<b>'],
          updated_at: '2026-11-17T09:00:00Z'
        },
        error: null
      },
      // The website was saved before the kit.
      brand_versions: {
        data: [
          { created_at: '2026-11-17T08:30:00Z', domain: 'cedarlane.example' }
        ],
        error: null
      },
      brand_logos: {
        data: {
          domain: 'old-site.example',
          on_light: 'https://old-site.example/l.png'
        },
        error: null
      },
      catalog_status: { data: { live: false }, error: null },
      products: { data: [{ title: 'Field overshirt' }], error: null }
    })
    mocks.createClient.mockResolvedValue(db)
    mocks.offersPage.mockResolvedValue(offers(20))
    const view = await setupReadModel(context)
    expect(view.found).toEqual({
      logo: null,
      colors: ['#1F3A2B', '#abc'],
      fonts: ['Lora'],
      products: ['Field overshirt'],
      catalogRead: true
    })
    const products = calls.find((c) => c.table === 'products')!
    expect(products.filters).toContainEqual(['eq', 'synthetic', true])
    expect(products.filters).toContainEqual(['eq', 'tenant_id', 'tenant-1'])
    // The readers' progress is read too (null here: no workspace row).
    expect(calls.some((c) => c.table === 'job_runs')).toBe(true)
    expect(view.reading).toBeNull()
  })

  it('lets Brand wait while the website is read, not once it was read or failed (UI-ONBc)', async () => {
    const site = (status: string) =>
      database({
        ...ready,
        onboarding_steps: {
          data: {
            brand_site: null,
            rivals_skipped_at: null,
            finished_at: null
          },
          error: null
        },
        tenants: {
          data: { created_at: '2026-11-17T08:00:00Z', timezone: 'UTC' },
          error: null
        },
        strategy_runs: { data: [], error: null },
        job_runs: {
          data: [
            {
              kind: 'brand.read_site',
              status,
              domain: 'cedarlane.example',
              checkpoint: {},
              failure_class: null,
              created_at: '2026-11-17T09:00:00Z',
              updated_at: '2026-11-17T09:00:00Z'
            }
          ],
          error: null
        }
      }).db
    mocks.offersPage.mockResolvedValue(offers(20))
    for (const [status, waits] of [
      ['queued', true],
      ['running', true],
      ['succeeded', false],
      ['failed', false]
    ] as const) {
      mocks.createClient.mockResolvedValue(site(status))
      const flow = (await setupReadModel(context)).flow!
      expect(flow.steps[1]!.waiting).toBe(waits)
      // Klaviyo and Discount are done here: while Brand waits, Rivals is Now.
      expect(flow.current).toBe(waits ? 4 : 1)
    }
  })

  it('waits for the website saved now, and hides what was found on the old one (ONB-SITEa)', async () => {
    const read = (
      domain: string,
      status: string,
      at: string,
      kind = 'brand.read_site'
    ) => ({
      kind,
      status,
      domain,
      checkpoint: {},
      failure_class: null,
      created_at: at,
      updated_at: at
    })
    const readA = read(
      'cedar-lane.example',
      'succeeded',
      '2026-11-17T09:00:00Z'
    )
    // A's ads and reviews were read too.
    const ownA = [
      readA,
      read(
        'cedar-lane.example',
        'succeeded',
        '2026-11-17T09:01:00Z',
        'brand.read_ads'
      ),
      read(
        'cedar-lane.example',
        'succeeded',
        '2026-11-17T09:02:00Z',
        'brand.read_reviews'
      )
    ]
    const view = (
      website: string,
      reads: unknown[],
      saves: { created_at: string; domain: string }[],
      kitAt = '2026-11-17T08:45:00Z'
    ) => {
      const { db, calls } = database({
        ...ready,
        brand_profiles: {
          data: { brand_name: 'Cedar Lane', domain: website, revision: 4 },
          error: null
        },
        // A changed website cleared the Brand mark (the database's trigger).
        onboarding_steps: {
          data: {
            brand_site: null,
            rivals_skipped_at: null,
            finished_at: null
          },
          error: null
        },
        tenants: {
          data: { created_at: '2026-11-17T08:00:00Z', timezone: 'UTC' },
          error: null
        },
        strategy_runs: { data: [], error: null },
        job_runs: { data: reads, error: null },
        brand_logos: {
          data: {
            domain: 'cedar-lane.example',
            on_light: 'https://cedar-lane.example/logo.png'
          },
          error: null
        },
        brand_kits: {
          data: { colors: ['#1F3A2B'], fonts: ['Lora'], updated_at: kitAt },
          error: null
        },
        brand_versions: { data: saves, error: null }
      })
      mocks.createClient.mockResolvedValue(db)
      return { calls }
    }
    mocks.offersPage.mockResolvedValue(offers(20))
    const savedA = {
      created_at: '2026-11-17T08:30:00Z',
      domain: 'cedar-lane.example'
    }
    const savedB = {
      created_at: '2026-11-17T10:00:00Z',
      domain: 'north-loft.example'
    }
    const state = (
      v: Awaited<ReturnType<typeof setupReadModel>>,
      key = 'site'
    ) => v.reading!.steps.find((s) => s.key === key)!.state
    const site = (v: Awaited<ReturnType<typeof setupReadModel>>) => state(v)

    // Website A was read, then changed to B: B's read is queued.
    const queuedB = read('north-loft.example', 'queued', '2026-11-17T10:00:01Z')
    const { calls } = view(
      'north-loft.example',
      [...ownA, queuedB],
      [savedB, savedA]
    )
    let v = await setupReadModel(context)
    expect(site(v)).toBe('waiting')
    // A's ads and reviews are not B's: not read yet.
    expect([state(v, 'ads'), state(v, 'reviews')]).toEqual([
      'not_started',
      'not_started'
    ])
    expect(v.flow!.steps[1]).toMatchObject({ done: false, waiting: true })
    expect(v.flow!.current).toBe(4)
    // A's logo, and the kit saved while the website was A, are not B's.
    expect(v.found).toMatchObject({ logo: null, colors: [], fonts: [] })
    for (const kind of [
      'brand.read_site',
      'brand.read_ads',
      'brand.read_reviews'
    ])
      expect(
        calls.find(
          (c) =>
            c.table === 'job_runs' &&
            c.filters.some((f) => f[1] === 'kind' && f[2] === kind)
        )!.filters
      ).toContainEqual(['eq', 'input->>domain', 'north-loft.example'])

    // No read of B at all: not read yet (Try again), never A's.
    view('north-loft.example', [readA], [savedB, savedA])
    v = await setupReadModel(context)
    expect(site(v)).toBe('not_started')
    expect(v.flow!.steps[1]).toMatchObject({ done: false, waiting: false })
    expect(v.flow!.current).toBe(1)

    // B read: Brand is Now, with B's own kit once saved since B.
    view(
      'north-loft.example',
      [readA, read('north-loft.example', 'succeeded', '2026-11-17T11:00:00Z')],
      [savedB, savedA],
      '2026-11-17T10:30:00Z'
    )
    v = await setupReadModel(context)
    expect(site(v)).toBe('done')
    expect(v.flow!.current).toBe(1)
    expect(v.found).toMatchObject({
      logo: null,
      colors: ['#1F3A2B'],
      fonts: ['Lora']
    })

    // Then back to A: A's own read counts again (B's newer one does not)
    // and A's logo shows; the kit saved before A was saved again does not.
    view(
      'cedar-lane.example',
      [...ownA, queuedB],
      [
        { created_at: '2026-11-17T12:00:00Z', domain: 'cedar-lane.example' },
        savedB,
        savedA
      ]
    )
    v = await setupReadModel(context)
    expect(site(v)).toBe('done')
    expect([state(v, 'ads'), state(v, 'reviews')]).toEqual(['done', 'done'])
    expect(v.flow!.steps[1]).toMatchObject({ done: false, waiting: false })
    expect(v.flow!.current).toBe(1)
    expect(v.found).toMatchObject({
      logo: 'https://cedar-lane.example/logo.png',
      colors: [],
      fonts: []
    })
  })

  it('shows the kit only when it was saved since the website was', () => {
    const at = (h: number) => `2026-11-17T${String(h).padStart(2, '0')}:00:00Z`
    expect(
      websiteSavedAt(
        [
          { created_at: at(12), domain: 'cedar-lane.example' },
          { created_at: at(11), domain: 'WWW.Cedar-Lane.example' },
          { created_at: at(10), domain: 'north-loft.example' },
          { created_at: at(9), domain: 'cedar-lane.example' }
        ],
        'cedar-lane.example'
      )
    ).toBe(at(11))
    // The newest save holds another website, or none: never saved.
    expect(
      websiteSavedAt(
        [{ created_at: at(12), domain: 'north-loft.example' }],
        'cedar-lane.example'
      )
    ).toBeNull()
    expect(websiteSavedAt([], 'cedar-lane.example')).toBeNull()
  })

  it('reads nothing found before a website is saved', async () => {
    const { db, calls } = database({
      ...ready,
      brand_profiles: {
        data: { brand_name: 'Cedar Lane', domain: '', revision: 1 },
        error: null
      }
    })
    mocks.createClient.mockResolvedValue(db)
    mocks.offersPage.mockResolvedValue(offers(null))
    const view = await setupReadModel(context)
    expect(view.found).toBeNull()
    expect(view.reading).toBeNull()
    expect(calls.some((c) => c.table === 'brand_kits')).toBe(false)
  })
})
