import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import { revalidatePath } from 'next/cache'
import { clearRevenueGoal, saveRevenueGoal } from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
let rpc: ReturnType<typeof vi.fn>
let currency: { data: unknown; error: unknown }
const asked: unknown[][] = []
const signedInAs = (tenantRole: string) =>
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole,
    timezone: 'America/New_York'
  })
const revisions = '2026-11-01:2,2026-12-01:0'
beforeEach(() => {
  // 20:00 on 30 November in New York is already 1 December in UTC.
  vi.useFakeTimers({ now: new Date('2026-12-01T01:00:00Z'), toFake: ['Date'] })
  env.values = { AUTH_MODE: 'supabase' }
  signedInAs('owner')
  asked.length = 0
  currency = { data: { currency: 'USD' }, error: null }
  rpc = vi.fn(async () => ({ data: 3, error: null }))
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: (...a: unknown[]) => (asked.push([table, ...a]), chain),
      maybeSingle: async () => currency
    }
    return chain
  }
  supabase.createClient.mockResolvedValue({ rpc, from })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('saveRevenueGoal (owner pick #33)', () => {
  it('reads the goal in the owner’s words, in the store’s month and currency, with that month’s revision', async () => {
    expect(
      await saveRevenueGoal({}, form({ goal: '$20k this month', revisions }))
    ).toEqual({
      message:
        'Saved. The goal for November 2026 is $20,000; new 15-day plans work back from it.'
    })
    expect(rpc).toHaveBeenCalledWith('set_revenue_goal', {
      t: tenant,
      goal_month: '2026-11-01',
      goal_amount: 20_000,
      goal_currency: 'USD',
      expected_revision: 2
    })
    expect(asked).toEqual([['catalog_status', 'tenant_id', tenant]])
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/plan')
    rpc.mockClear()
    await saveRevenueGoal({}, form({ goal: '25,000 next month', revisions }))
    expect(rpc).toHaveBeenCalledWith('set_revenue_goal', {
      t: tenant,
      goal_month: '2026-12-01',
      goal_amount: 25_000,
      goal_currency: 'USD',
      expected_revision: 0
    })
  })

  it('refuses words it cannot read, another currency and a later month, never calling the database', async () => {
    for (const goal of ['20% off', 'about 20k', 'cancel the goal'])
      expect((await saveRevenueGoal({}, form({ goal, revisions }))).error).toBe(
        'Type one amount and at most one month, like $20,000 this month or 20k next month.'
      )
    expect(
      (await saveRevenueGoal({}, form({ goal: '€5,000', revisions }))).error
    ).toBe('Your store sells in USD: type the goal in USD.')
    expect(
      (await saveRevenueGoal({}, form({ goal: '$5k in March', revisions })))
        .error
    ).toBe('Set a goal for this month or next month.')
    expect(
      (await saveRevenueGoal({}, form({ goal: ' ', revisions }))).error
    ).toBe('Type the goal, like $20k this month.')
    // A page read before the month turned: its months are not these.
    expect(
      (
        await saveRevenueGoal(
          {},
          form({ goal: '$20k', revisions: '2026-10-01:1' })
        )
      ).error
    ).toBe('Reload the page and try again.')
    for (const bad of ['', 'x', '2026-11-01:-1', '2026-11-01:1,2026-11-01:2'])
      expect(
        (await saveRevenueGoal({}, form({ goal: '$20k', revisions: bad })))
          .error
      ).toBe('Reload the page and try again.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('asks for a currency while the store’s is not known', async () => {
    currency = { data: { currency: null }, error: null }
    expect(
      (await saveRevenueGoal({}, form({ goal: '$20k', revisions }))).error
    ).toBe(
      'Type one amount with its currency and at most one month, like 20,000 USD this month.'
    )
    await saveRevenueGoal({}, form({ goal: '20,000 AUD', revisions }))
    expect(rpc).toHaveBeenCalledWith(
      'set_revenue_goal',
      expect.objectContaining({ goal_currency: 'AUD', goal_amount: 20_000 })
    )
  })

  it('lets admins save, refuses staff and the demo, and explains the database’s answers', async () => {
    signedInAs('staff')
    expect(
      (await saveRevenueGoal({}, form({ goal: '$20k', revisions }))).error
    ).toBe('Only the owner or an admin can change the revenue goal.')
    expect(rpc).not.toHaveBeenCalled()
    signedInAs('admin')
    for (const [code, words] of [
      ['PT409', /changed in another window/],
      ['42501', /owner or an admin/],
      ['23514', /Check the amount/],
      ['XX000', /Nothing was changed/]
    ] as const) {
      rpc.mockResolvedValueOnce({ data: null, error: { code } })
      expect(
        (await saveRevenueGoal({}, form({ goal: '$20k', revisions }))).error
      ).toMatch(words)
    }
    expect(revalidatePath).not.toHaveBeenCalled()
    currency = { data: null, error: { code: 'XX000' } }
    expect(
      (await saveRevenueGoal({}, form({ goal: '$20k', revisions }))).error
    ).toMatch(/Nothing was changed/)
    signedInAs('owner')
    env.values = { AUTH_MODE: 'demo' }
    expect(
      (await saveRevenueGoal({}, form({ goal: '$20k', revisions }))).error
    ).toMatch(/sign in again/)
  })
})

describe('clearRevenueGoal (owner pick #33)', () => {
  it('clears a month’s goal with its revision', async () => {
    expect(
      await clearRevenueGoal({}, form({ month: '2026-12-01', revision: '1' }))
    ).toEqual({
      message:
        'Removed the goal for December 2026. New plans have no goal for it.'
    })
    expect(rpc).toHaveBeenCalledWith('set_revenue_goal', {
      t: tenant,
      goal_month: '2026-12-01',
      goal_amount: null,
      goal_currency: null,
      expected_revision: 1
    })
  })

  it('refuses a bad month or revision, staff, and explains a stale page', async () => {
    for (const values of [
      { month: '2026-12-02', revision: '1' },
      { month: '2026-13-01', revision: '1' },
      { month: '2026-12-01', revision: 'x' }
    ])
      expect((await clearRevenueGoal({}, form(values))).error).toBe(
        'Reload the page and try again.'
      )
    signedInAs('staff')
    expect(
      (await clearRevenueGoal({}, form({ month: '2026-12-01', revision: '1' })))
        .error
    ).toMatch(/owner or an admin/)
    expect(rpc).not.toHaveBeenCalled()
    signedInAs('owner')
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409' } })
    expect(
      (await clearRevenueGoal({}, form({ month: '2026-12-01', revision: '1' })))
        .error
    ).toMatch(/changed in another window/)
  })
})
