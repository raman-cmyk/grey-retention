import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/features/integrations/worker', () => ({
  runFixtureJobs: vi.fn()
}))

import {
  runScheduledJobs,
  separatelyDispatchedKinds,
  tenantsWithDueJobs
} from './scheduler'

type Row = Record<string, unknown>
type Call = { table: string; ops: [string, unknown[]][] }

/** Chainable PostgREST stand-in: records every filter and resolves rows. */
function fakeDb(tables: {
  tenants?: Row[] | Error
  due?: Row[] | Error
  stale?: Row[] | Error
}) {
  const calls: Call[] = []
  const from = (table: string) => {
    const call: Call = { table, ops: [] }
    calls.push(call)
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'in', 'lt', 'lte', 'not', 'order'])
      builder[op] = (...args: unknown[]) => {
        call.ops.push([op, args])
        return builder
      }
    builder.limit = (...args: unknown[]) => {
      call.ops.push(['limit', args])
      const stale = call.ops.some(
        ([op, a]) => op === 'in' && (a[1] as string[]).includes('running')
      )
      const value =
        table === 'tenants' ? tables.tenants : stale ? tables.stale : tables.due
      return Promise.resolve(
        value instanceof Error
          ? { data: null, error: value }
          : { data: value ?? [], error: null }
      )
    }
    return builder
  }
  return {
    db: { from } as unknown as Parameters<typeof runScheduledJobs>[0],
    calls
  }
}

const ids = (...names: string[]) => names.map((id) => ({ id }))
const tenantRows = (...names: string[]) =>
  names.map((tenant_id) => ({ tenant_id }))

describe('tenantsWithDueJobs', () => {
  it('finds due and stale-leased work, oldest first, without duplicates', async () => {
    const { db, calls } = fakeDb({
      due: tenantRows('b', 'a', 'b'),
      stale: tenantRows('c', 'a')
    })
    expect(
      await tenantsWithDueJobs(db, '2026-11-06T10:00:00.000Z', 50)
    ).toEqual(['b', 'a', 'c'])
    const [due, stale] = calls
    expect(due!.ops).toContainEqual([
      'in',
      ['status', ['queued', 'retry_wait']]
    ])
    expect(due!.ops).toContainEqual(['lt', ['attempt', 4]])
    expect(due!.ops).toContainEqual([
      'lte',
      ['available_at', '2026-11-06T10:00:00.000Z']
    ])
    expect(stale!.ops).toContainEqual(['in', ['status', ['leased', 'running']]])
    expect(stale!.ops).toContainEqual([
      'lt',
      ['lease_until', '2026-11-06T10:00:00.000Z']
    ])
    for (const call of calls) {
      expect(call.ops).toContainEqual([
        'select',
        ['tenant_id, tenants!inner(status)']
      ])
      expect(call.ops).toContainEqual(['eq', ['tenants.status', 'active']])
      expect(call.ops).toContainEqual(['limit', [50]])
      expect(call.ops).toContainEqual([
        'not',
        [
          'kind',
          'in',
          '("email.rewrite","email.import","brand.read_site","brand.read_catalog","brand.read_history","brand.read_ads")'
        ]
      ])
    }
  })

  it('never selects paid AI rewrites, file imports or source reads', () => {
    expect(separatelyDispatchedKinds).toEqual([
      'email.rewrite',
      'email.import',
      'brand.read_site',
      'brand.read_catalog',
      'brand.read_history',
      'brand.read_ads'
    ])
  })

  it('fails instead of guessing when the queue cannot be read', async () => {
    const { db } = fakeDb({ due: new Error('read failed') })
    await expect(tenantsWithDueJobs(db, 'x')).rejects.toThrow('read failed')
    const stale = fakeDb({ stale: new Error('stale read failed') })
    await expect(tenantsWithDueJobs(stale.db, 'x')).rejects.toThrow(
      'stale read failed'
    )
  })
})

describe('runScheduledJobs', () => {
  const run =
    vi.fn<(db: unknown, tenant: string, limit: number) => Promise<number>>()
  beforeEach(() => {
    run.mockReset()
    run.mockResolvedValue(0)
  })

  it('does nothing when there are no active workspaces', async () => {
    const { db } = fakeDb({ tenants: [] })
    expect(await runScheduledJobs(db, { run })).toEqual({
      tenants: 0,
      processed: 0,
      failed: 0,
      deferred: 0,
      rounds: 0
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('visits every active workspace once when queues are empty', async () => {
    const { db, calls } = fakeDb({ tenants: ids('a', 'b', 'c') })
    const result = await runScheduledJobs(db, { run, random: () => 0 })
    expect(result).toMatchObject({ tenants: 3, processed: 0, rounds: 1 })
    expect(run.mock.calls.map(([, t, limit]) => [t, limit])).toEqual([
      ['b', 4],
      ['c', 4],
      ['a', 4]
    ])
    expect(calls[0]!.ops).toContainEqual(['eq', ['status', 'active']])
  })

  it('runs workspaces with waiting jobs first, then housekeeping for the rest', async () => {
    const { db } = fakeDb({
      tenants: ids('a', 'b', 'c'),
      due: tenantRows('c'),
      stale: tenantRows('b')
    })
    run.mockImplementation(async (_db, tenant) => (tenant === 'c' ? 2 : 1))
    const result = await runScheduledJobs(db, { run, random: () => 0 })
    expect(run.mock.calls.map(([, t]) => t)).toEqual(['c', 'b', 'a'])
    expect(result).toMatchObject({ tenants: 3, processed: 4, failed: 0 })
  })

  it('still visits a waiting workspace outside the active-workspace page', async () => {
    const { db } = fakeDb({ tenants: ids('a'), due: tenantRows('z') })
    await runScheduledJobs(db, { run, limits: { activeRows: 1 } })
    expect(run.mock.calls.map(([, t]) => t)).toEqual(['z', 'a'])
  })

  it('gives busy workspaces extra rounds, bounded by maxRounds', async () => {
    const { db } = fakeDb({ tenants: ids('a', 'b'), due: tenantRows('a') })
    run.mockImplementation(async (_db, tenant) => (tenant === 'a' ? 4 : 0))
    const result = await runScheduledJobs(db, {
      run,
      random: () => 0,
      limits: { maxRounds: 3 }
    })
    expect(run.mock.calls.map(([, t]) => t)).toEqual(['a', 'b', 'a', 'a'])
    expect(result).toMatchObject({ tenants: 2, processed: 12, rounds: 3 })
  })

  it('keeps going when one workspace fails, and counts the failure', async () => {
    const { db } = fakeDb({ tenants: ids('a', 'b', 'c') })
    run.mockImplementation(async (_db, tenant) => {
      if (tenant === 'b') throw Object.assign(new Error('x'), { code: '42501' })
      return 1
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await runScheduledJobs(db, { run, random: () => 0.99 })
    expect(result).toMatchObject({ tenants: 3, processed: 2, failed: 1 })
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]![0])).toContain('"code":"42501"')
    warn.mockRestore()
  })

  it('stops starting visits after the time budget and reports the rest as deferred', async () => {
    const { db } = fakeDb({ tenants: ids('a', 'b', 'c', 'd') })
    let clock = 0
    run.mockImplementation(async () => {
      clock += 15_000
      return 1
    })
    const result = await runScheduledJobs(db, {
      run,
      now: () => clock,
      random: () => 0.99,
      limits: { budgetMs: 40_000 }
    })
    expect(run).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      tenants: 3,
      processed: 3,
      deferred: 1,
      rounds: 1
    })
  })

  it('counts no round when the budget is already spent', async () => {
    const { db } = fakeDb({ tenants: ids('a') })
    const result = await runScheduledJobs(db, {
      run,
      now: (() => {
        let t = 0
        return () => (t += 50_000) - 50_000
      })(),
      limits: { budgetMs: 40_000 }
    })
    expect(run).not.toHaveBeenCalled()
    expect(result).toMatchObject({ tenants: 0, rounds: 0, deferred: 1 })
  })

  it('caps the number of workspaces per request', async () => {
    const { db } = fakeDb({ tenants: ids('a', 'b', 'c', 'd', 'e') })
    const result = await runScheduledJobs(db, {
      run,
      random: () => 0.99,
      limits: { maxTenants: 2 }
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ tenants: 2, deferred: 3 })
  })

  it('fails the whole run when active workspaces cannot be read', async () => {
    const { db } = fakeDb({ tenants: new Error('denied') })
    await expect(runScheduledJobs(db, { run })).rejects.toThrow('denied')
    expect(run).not.toHaveBeenCalled()
  })
})
