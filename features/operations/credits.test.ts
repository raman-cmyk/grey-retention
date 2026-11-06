import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const result = vi.hoisted(() => ({
  value: { data: null as unknown, error: null as unknown },
  db: true
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!result.db) return null
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => result.value
    }
    return { from: () => chain }
  }
}))

const { workspaceCredits } = await import('./credits')
const now = new Date('2026-11-06T12:00:00Z')
const owner = { kind: 'client', tenantId: 't1', tenantRole: 'owner' } as never
const staff = { kind: 'client', tenantId: 't1', tenantRole: 'staff' } as never

afterEach(() => {
  result.value = { data: null, error: null }
  result.db = true
})

describe('workspace AI credits', () => {
  it('reads the active package cycle, as on Settings', async () => {
    result.value = {
      data: {
        allocation_micro: 10_000_000,
        used_micro: 2_000_000,
        reserved_micro: 500_000,
        ends_at: '2026-12-06T12:00:00Z',
        snapshot: { name: 'Growth package' }
      },
      error: null
    }
    const credits = await workspaceCredits(owner, now)
    expect(credits).toMatchObject({
      plan: 'Growth package',
      used: 2_500_000,
      included: 10_000_000,
      sample: true
    })
    expect(credits!.renewsInDays).toBe(30)
    expect(credits!.format(2_500_000)).toBe('$2.50')
  })

  it('is hidden from staff, and says "not available" without a cycle', async () => {
    expect(await workspaceCredits(staff, now)).toBeNull()
    const none = await workspaceCredits(owner, now)
    expect(none).toMatchObject({ included: 0 })
    result.db = false
    expect(await workspaceCredits(owner, now)).toBeNull()
  })
})
