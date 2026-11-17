// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  setupReadModel: vi.fn(),
  createClient: vi.fn(),
  row: { data: null as unknown, error: null as unknown },
  filters: [] as unknown[][]
}))
vi.mock('./flow', () => ({ setupReadModel: mocks.setupReadModel }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { setupFlow, type SetupRecords } from './flow-model'
import { setupLanding } from './landing'

const context = {
  kind: 'client' as const,
  userId: 'user-1',
  tenantId: 'tenant-1',
  tenantRole: 'owner' as const,
  tenantName: 'Cedar Lane',
  tenantSlug: 'cedar-lane',
  timezone: 'UTC'
}
const records: SetupRecords = {
  domain: 'cedarlane.example',
  confirmedSite: 'cedarlane.example',
  klaviyoWorking: true,
  maxDiscountSet: true,
  following: 0,
  rivalsSkipped: false,
  finished: false,
  tracked: true
}
const view = (over: Partial<SetupRecords>, keyCheck = 'sample') => ({
  flow: setupFlow({ ...records, ...over }),
  keyCheck
})
const db = {
  from: () => {
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => (mocks.filters.push(args), chain),
      maybeSingle: async () => mocks.row
    }
    return chain
  }
}

describe('setupLanding (UI-ONBe)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.filters.length = 0
    mocks.createClient.mockResolvedValue(db)
    mocks.row = { data: { finished_at: null }, error: null }
  })

  it('lands an owner on /setup while his onboarding is neither finished nor done', async () => {
    mocks.setupReadModel.mockResolvedValue(view({}))
    expect(await setupLanding(context)).toBe('/setup')
    expect(mocks.filters).toContainEqual(['tenant_id', 'tenant-1'])
    mocks.setupReadModel.mockResolvedValue(view({ rivalsSkipped: true }))
    expect(await setupLanding(context)).toBe('/home')
  })

  it('sends a workspace from before onboarding (no row) or a finished one Home, reading only its row', async () => {
    mocks.row = { data: null, error: null }
    expect(await setupLanding(context)).toBe('/home')
    mocks.row = { data: { finished_at: '2026-11-17T10:00:00Z' }, error: null }
    expect(await setupLanding(context)).toBe('/home')
    mocks.row = { data: null, error: { code: '42501' } }
    expect(await setupLanding(context)).toBe('/home')
    expect(mocks.setupReadModel).not.toHaveBeenCalled()
  })

  it('does not send him to a Klaviyo step he cannot do (connecting off)', async () => {
    mocks.setupReadModel.mockResolvedValue(
      view({ klaviyoWorking: false }, 'off')
    )
    expect(await setupLanding(context)).toBe('/home')
    mocks.setupReadModel.mockResolvedValue(view({ klaviyoWorking: false }))
    expect(await setupLanding(context)).toBe('/setup')
  })

  it('lands him Home while only a waiting Brand is left, and on /setup once it was read', async () => {
    const waiting = { confirmedSite: null, siteReading: true }
    mocks.setupReadModel.mockResolvedValue(
      view({ ...waiting, rivalsSkipped: true })
    )
    expect(await setupLanding(context)).toBe('/home')
    // Brand waits, but Rivals is still to do: setup.
    mocks.setupReadModel.mockResolvedValue(view(waiting))
    expect(await setupLanding(context)).toBe('/setup')
    // Read, or its read failed: Brand is Now again.
    mocks.setupReadModel.mockResolvedValue(
      view({ ...waiting, siteReading: false, rivalsSkipped: true })
    )
    expect(await setupLanding(context)).toBe('/setup')
  })

  it('lands staff, admins and an unreadable setup on Home', async () => {
    mocks.setupReadModel.mockResolvedValue(view({}))
    expect(await setupLanding({ ...context, tenantRole: 'staff' })).toBe(
      '/home'
    )
    expect(await setupLanding({ ...context, tenantRole: 'admin' })).toBe(
      '/home'
    )
    expect(mocks.createClient).not.toHaveBeenCalled()
    mocks.setupReadModel.mockResolvedValue({ flow: null, keyCheck: 'sample' })
    expect(await setupLanding(context)).toBe('/home')
  })
})
