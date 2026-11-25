// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const next = vi.hoisted(() => ({ after: vi.fn() }))
vi.mock('next/server', () => next)
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)

import {
  brandBookWriteKind,
  rewriteBrandBookSoon,
  runBrandBookWrites,
  writeFailure
} from './brand-book-writes'

/**
 * UI-BRAND-2: the Brand book rewrite runs through the leased job queue:
 * claimed (one workspace's, or any), finished under its lease with the
 * book's version, or failed through `fail_job` to be tried again. It never
 * throws, and starts no write past its deadline.
 */
type Call = { name: string; args?: unknown }
function database(
  jobs: { id: string; tenant_id: string }[],
  { claimError = null as unknown, finishError = null as unknown } = {}
) {
  const queue = [...jobs]
  const calls: Call[] = []
  const rpc = vi.fn(async (name: string, args?: unknown) => {
    calls.push({ name, args })
    if (name === 'claim_brand_book_write') {
      if (claimError) return { data: null, error: claimError }
      const job = queue.shift()
      return {
        data: job ? [{ ...job, lease_token: `lease-${job.id}` }] : [],
        error: null
      }
    }
    if (name === 'finish_brand_book_write')
      return { data: null, error: finishError }
    return { data: null, error: null }
  })
  const from = vi.fn(() => {
    const link: Record<string, unknown> = {}
    for (const step of ['select', 'eq', 'order']) link[step] = () => link
    link.limit = async () => ({ data: [{ version: 9 }], error: null })
    return link
  })
  return {
    calls,
    db: { rpc, from } as unknown as Parameters<typeof runBrandBookWrites>[0]
  }
}

afterEach(() => vi.clearAllMocks())

describe('runBrandBookWrites', () => {
  it('claims the workspace’s rewrite, writes the book and finishes it under its lease', async () => {
    const { db, calls } = database([{ id: 'j1', tenant_id: 't1' }])
    const write = vi.fn(async () => 7)
    expect(await runBrandBookWrites(db, { tenantId: 't1', write })).toEqual({
      ran: 1,
      failed: 0
    })
    expect(write).toHaveBeenCalledExactlyOnceWith(db, 't1')
    expect(calls).toEqual([
      { name: 'claim_brand_book_write', args: { t: 't1' } },
      {
        name: 'finish_brand_book_write',
        args: { job: 'j1', lease: 'lease-j1', book_version: 7 }
      }
    ])
  })

  it('records the newest version when the book did not change', async () => {
    const { db, calls } = database([{ id: 'j1', tenant_id: 't1' }])
    await runBrandBookWrites(db, { write: async () => null })
    expect(calls[0]).toEqual({ name: 'claim_brand_book_write', args: {} })
    expect(calls[1]!.args).toMatchObject({ book_version: 9 })
  })

  it('fails a write that throws or runs out of time, to be tried again, and goes on', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db, calls } = database([
      { id: 'j1', tenant_id: 't1' },
      { id: 'j2', tenant_id: 't2' },
      { id: 'j3', tenant_id: 't3' }
    ])
    const write = vi.fn(async (_db: unknown, t: string) => {
      if (t === 't1') throw Object.assign(new Error('x'), { code: '08006' })
      if (t === 't2') return new Promise(() => {})
      return 3
    })
    expect(await runBrandBookWrites(db, { limit: 3, write, ms: 20 })).toEqual({
      ran: 1,
      failed: 2
    })
    expect(calls.filter((c) => c.name === 'fail_job')).toEqual([
      {
        name: 'fail_job',
        args: { job: 'j1', lease: 'lease-j1', failure: 'transient' }
      },
      {
        name: 'fail_job',
        args: { job: 'j2', lease: 'lease-j2', failure: 'transient' }
      }
    ])
    expect(calls.at(-1)).toEqual({
      name: 'finish_brand_book_write',
      args: { job: 'j3', lease: 'lease-j3', book_version: 3 }
    })
  })

  it('fails a write whose lease was lost, never finishing it twice', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db, calls } = database([{ id: 'j1', tenant_id: 't1' }], {
      finishError: { code: 'PT409' }
    })
    expect(await runBrandBookWrites(db, { write: async () => 2 })).toEqual({
      ran: 0,
      failed: 1
    })
    expect(calls.map((c) => c.name)).toEqual([
      'claim_brand_book_write',
      'finish_brand_book_write',
      'fail_job'
    ])
  })

  it('starts no write past its deadline, and never throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db, calls } = database([{ id: 'j1', tenant_id: 't1' }])
    expect(
      await runBrandBookWrites(db, {
        deadline: 1_000,
        now: () => 990,
        ms: 20,
        write: async () => 1
      })
    ).toEqual({ ran: 0, failed: 0 })
    expect(calls).toEqual([])
    const broken = database([], { claimError: { code: 'PGRST301' } })
    expect(await runBrandBookWrites(broken.db)).toEqual({ ran: 0, failed: 0 })
  })

  it('stops when nothing is waiting', async () => {
    const { db, calls } = database([])
    expect(await runBrandBookWrites(db, { limit: 5 })).toEqual({
      ran: 0,
      failed: 0
    })
    expect(calls).toHaveLength(1)
  })
})

describe('writeFailure', () => {
  it('tries again unless the corrections can never fit', () => {
    expect(writeFailure({ code: 'brand_book_timeout' })).toBe('transient')
    expect(writeFailure({ code: '08006' })).toBe('transient')
    expect(writeFailure(null)).toBe('transient')
    expect(writeFailure({ code: 'too_many_corrections' })).toBe('validation')
  })
})

describe('rewriteBrandBookSoon', () => {
  it('runs the workspace’s rewrite after the reply, as the worker', async () => {
    const { db, calls } = database([{ id: 'j1', tenant_id: 't1' }])
    service.createServiceClient.mockReturnValue(db)
    rewriteBrandBookSoon('t1')
    expect(next.after).toHaveBeenCalledOnce()
    expect(calls).toEqual([])
    // A real write would read the workspace; here the book read fails fast.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await (next.after.mock.calls[0]![0] as () => Promise<void>)()
    expect(calls[0]).toEqual({
      name: 'claim_brand_book_write',
      args: { t: 't1' }
    })
  })

  it('leaves the rewrite queued when there is no worker client', async () => {
    service.createServiceClient.mockReturnValue(null)
    rewriteBrandBookSoon('t1')
    await (next.after.mock.calls[0]![0] as () => Promise<void>)()
    expect(brandBookWriteKind).toBe('brand.write_book')
  })
})
