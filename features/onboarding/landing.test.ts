// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const setupReadModel = vi.hoisted(() => vi.fn())
vi.mock('./flow', () => ({ setupReadModel }))

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
  finished: false
}
const flow = (over: Partial<SetupRecords>) => ({
  flow: setupFlow({ ...records, ...over })
})

describe('setupLanding (UI-ONBe)', () => {
  beforeEach(() => setupReadModel.mockReset())

  it('lands an owner on /setup until setup is finished or every step done', async () => {
    setupReadModel.mockResolvedValue(flow({}))
    expect(await setupLanding(context)).toBe('/setup')
    setupReadModel.mockResolvedValue(flow({ rivalsSkipped: true }))
    expect(await setupLanding(context)).toBe('/home')
    setupReadModel.mockResolvedValue(flow({ finished: true }))
    expect(await setupLanding(context)).toBe('/home')
  })

  it('lands staff, admins and an unreadable setup on Home', async () => {
    setupReadModel.mockResolvedValue(flow({}))
    expect(await setupLanding({ ...context, tenantRole: 'staff' })).toBe(
      '/home'
    )
    expect(await setupLanding({ ...context, tenantRole: 'admin' })).toBe(
      '/home'
    )
    expect(setupReadModel).not.toHaveBeenCalled()
    setupReadModel.mockResolvedValue({ flow: null })
    expect(await setupLanding(context)).toBe('/home')
  })
})
