// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const next = vi.hoisted(() => ({ after: vi.fn() }))
vi.mock('next/server', () => next)
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)

import type { BrandBookContent } from './brand-book'
import {
  brandBookWriteKind,
  clickDeadlineMs,
  clickWriteMs,
  prepareBrandBookWrite,
  rewriteBrandBookNow,
  rewriteBrandBookSoon,
  runBrandBookWrites,
  writeFailure
} from './brand-book-writes'

/**
 * UI-BRAND-2: the Brand book rewrite runs through the leased job queue:
 * claimed (one workspace's, or any), its book saved with the finish under
 * the lease on top of the version it read, or failed through `fail_job`
 * to be tried again. It never throws, starts no write past its deadline,
 * and a click waits for its workspace's running write, then runs the one
 * queued behind it.
 */
type Call = { name: string; args?: unknown }
const book = (voice: string) =>
  ({ observed: { voice: [voice] } }) as unknown as BrandBookContent

function database(
  jobs: ({ id: string; tenant_id: string } | 'busy')[],
  {
    claimError = null as unknown,
    finishError = null as unknown,
    finishErrors = [] as unknown[],
    newest = { version: 4, content: book('Calm') } as unknown,
    waiting = [] as boolean[]
  } = {}
) {
  const queue = [...jobs]
  const waits = [...waiting]
  const calls: Call[] = []
  const rpc = vi.fn(async (name: string, args?: unknown) => {
    calls.push({ name, args })
    if (name === 'claim_brand_book_write') {
      if (claimError) return { data: null, error: claimError }
      const job = queue.shift()
      return {
        data:
          job && job !== 'busy'
            ? [{ ...job, lease_token: `lease-${job.id}` }]
            : [],
        error: null
      }
    }
    if (name === 'finish_brand_book_write')
      return {
        data: 5,
        error: finishErrors.length ? finishErrors.shift() : finishError
      }
    return { data: null, error: null }
  })
  const from = vi.fn((table: string) => {
    const link: Record<string, unknown> = {}
    for (const step of ['select', 'eq', 'order', 'in', 'lt', 'lte'])
      link[step] = () => link
    link.limit = async () =>
      table === 'job_runs'
        ? { data: waits.shift() ? [{ id: 'w' }] : [], error: null }
        : { data: newest ? [newest] : [], error: null }
    return link
  })
  return {
    calls,
    db: { rpc, from } as unknown as Parameters<typeof runBrandBookWrites>[0]
  }
}

afterEach(() => vi.clearAllMocks())

describe('prepareBrandBookWrite', () => {
  it('writes the book on top of the newest version it read', async () => {
    const { db } = database([])
    expect(
      await prepareBrandBookWrite(db, 't1', async () => book('Plain'))
    ).toEqual({
      basedOn: 4,
      content: book('Plain')
    })
  })

  it('saves nothing for an unchanged book, the strategist’s reading aside', async () => {
    const { db } = database([], {
      newest: {
        version: 4,
        content: { ...book('Calm'), strategy: { positioning: 'x' } }
      }
    })
    expect(
      await prepareBrandBookWrite(db, 't1', async () => book('Calm'))
    ).toEqual({
      basedOn: 4,
      content: null
    })
  })

  it('saves nothing for a real store with only sample data, and starts at 0', async () => {
    const { db } = database([], { newest: null })
    expect(await prepareBrandBookWrite(db, 't1', async () => null)).toEqual({
      basedOn: 0,
      content: null
    })
  })
})

describe('runBrandBookWrites', () => {
  it('claims the workspace’s rewrite and saves the book with the finish, under its lease', async () => {
    const { db, calls } = database([{ id: 'j1', tenant_id: 't1' }])
    const prepare = vi.fn(async () => ({ basedOn: 4, content: book('Plain') }))
    expect(await runBrandBookWrites(db, { tenantId: 't1', prepare })).toEqual({
      ran: 1,
      failed: 0
    })
    expect(prepare).toHaveBeenCalledExactlyOnceWith(db, 't1')
    expect(calls).toEqual([
      { name: 'claim_brand_book_write', args: { t: 't1' } },
      {
        name: 'finish_brand_book_write',
        args: {
          job: 'j1',
          lease: 'lease-j1',
          based_on: 4,
          content: book('Plain'),
          written_by: 'brand-book@2'
        }
      }
    ])
  })

  it('finishes with nothing to save when the book did not change', async () => {
    const { db, calls } = database([{ id: 'j1', tenant_id: 't1' }])
    await runBrandBookWrites(db, {
      prepare: async () => ({ basedOn: 4, content: null })
    })
    expect(calls[0]).toEqual({ name: 'claim_brand_book_write', args: {} })
    expect(calls[1]!.args).toMatchObject({
      based_on: 4,
      content: null,
      written_by: null
    })
  })

  it('fails a write that throws or runs out of time, to be tried again, and goes on', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db, calls } = database([
      { id: 'j1', tenant_id: 't1' },
      { id: 'j2', tenant_id: 't2' },
      { id: 'j3', tenant_id: 't3' }
    ])
    const prepare = vi.fn(async (_db: unknown, t: string) => {
      if (t === 't1') throw Object.assign(new Error('x'), { code: '08006' })
      if (t === 't2') return new Promise<never>(() => {})
      return { basedOn: 1, content: book('Plain') }
    })
    expect(await runBrandBookWrites(db, { limit: 3, prepare, ms: 20 })).toEqual(
      {
        ran: 1,
        failed: 2
      }
    )
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
    // The timed-out write never reached the finish, which saves the book.
    expect(
      calls
        .filter((c) => c.name === 'finish_brand_book_write')
        .map((c) => (c.args as { job: string }).job)
    ).toEqual(['j3'])
  })

  it('fails a write whose lease was lost', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db, calls } = database([{ id: 'j1', tenant_id: 't1' }], {
      finishError: { code: 'PT409', message: 'Lease unavailable' }
    })
    expect(
      await runBrandBookWrites(db, {
        prepare: async () => ({ basedOn: 3, content: book('Old') })
      })
    ).toEqual({ ran: 0, failed: 1 })
    expect(calls.map((c) => c.name)).toEqual([
      'claim_brand_book_write',
      'finish_brand_book_write',
      'fail_job'
    ])
    expect(calls[2]!.args).toMatchObject({ failure: 'transient' })
  })

  it('writes once more from a newer book the strategist saved meanwhile, under the same lease', async () => {
    const { db, calls } = database([{ id: 'j1', tenant_id: 't1' }], {
      finishErrors: [{ code: 'PT409', hint: 'brand_book_changed' }, null]
    })
    const prepare = vi
      .fn()
      .mockResolvedValueOnce({ basedOn: 3, content: book('Plain') })
      .mockResolvedValueOnce({ basedOn: 4, content: book('Plain') })
    expect(await runBrandBookWrites(db, { tenantId: 't1', prepare })).toEqual({
      ran: 1,
      failed: 0
    })
    expect(
      calls
        .filter((c) => c.name === 'finish_brand_book_write')
        .map((c) => (c.args as { based_on: number }).based_on)
    ).toEqual([3, 4])
    expect(calls.map((c) => c.name)).not.toContain('fail_job')
  })

  it('fails when the book changed again, or there is no time to write it again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const changed = { code: 'PT409', hint: 'brand_book_changed' }
    const twice = database([{ id: 'j1', tenant_id: 't1' }], {
      finishErrors: [changed, changed]
    })
    const prepare = async () => ({ basedOn: 3, content: book('Plain') })
    expect(await runBrandBookWrites(twice.db, { prepare })).toEqual({
      ran: 0,
      failed: 1
    })
    expect(
      twice.calls.filter((c) => c.name === 'finish_brand_book_write')
    ).toHaveLength(2)
    let clock = 0
    const late = database([{ id: 'j1', tenant_id: 't1' }], {
      finishErrors: [changed]
    })
    expect(
      await runBrandBookWrites(late.db, {
        deadline: 100,
        ms: 50,
        now: () => (clock += 30),
        prepare
      })
    ).toEqual({ ran: 0, failed: 1 })
    expect(
      late.calls.filter((c) => c.name === 'finish_brand_book_write')
    ).toHaveLength(1)
  })

  it('never retries a book the database refuses', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db, calls } = database([{ id: 'j1', tenant_id: 't1' }], {
      finishError: { code: '23514', message: 'Invalid Brand book' }
    })
    await runBrandBookWrites(db, {
      prepare: async () => ({ basedOn: 3, content: book('Plain') })
    })
    expect(calls.at(-1)).toEqual({
      name: 'fail_job',
      args: { job: 'j1', lease: 'lease-j1', failure: 'validation' }
    })
  })

  it('waits for the workspace’s running write, then runs the one queued behind it', async () => {
    const { db, calls } = database(
      ['busy', 'busy', { id: 'j2', tenant_id: 't1' }],
      {
        waiting: [true, true]
      }
    )
    const sleep = vi.fn(async () => {})
    expect(
      await runBrandBookWrites(db, {
        tenantId: 't1',
        limit: 3,
        deadline: Date.now() + 60_000,
        waitForBusy: true,
        sleep,
        prepare: async () => ({ basedOn: 4, content: book('Plain') })
      })
    ).toEqual({ ran: 1, failed: 0 })
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(
      calls.filter((c) => c.name === 'claim_brand_book_write')
    ).toHaveLength(4)
  })

  it('stops waiting when nothing is queued behind, or when a whole write no longer fits', async () => {
    const idle = database(['busy'], { waiting: [false] })
    const sleep = vi.fn(async () => {})
    await runBrandBookWrites(idle.db, {
      tenantId: 't1',
      deadline: Date.now() + 60_000,
      waitForBusy: true,
      sleep
    })
    expect(sleep).not.toHaveBeenCalled()
    // 600 ms left, a write takes 200: the claim fits, a wait of 500 does not.
    const late = database(['busy'], { waiting: [true] })
    await runBrandBookWrites(late.db, {
      tenantId: 't1',
      deadline: 1_000,
      now: () => 400,
      ms: 200,
      waitForBusy: true,
      sleep
    })
    expect(sleep).not.toHaveBeenCalled()
    // Without waitForBusy (the readers' run) it never waits.
    const readers = database(['busy'], { waiting: [true] })
    await runBrandBookWrites(readers.db, {
      tenantId: 't1',
      deadline: Date.now() + 60_000,
      sleep
    })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('starts no write past its deadline, and never throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db, calls } = database([{ id: 'j1', tenant_id: 't1' }])
    expect(
      await runBrandBookWrites(db, {
        deadline: 1_000,
        now: () => 990,
        ms: 20,
        prepare: async () => ({ basedOn: 0, content: null })
      })
    ).toEqual({ ran: 0, failed: 0 })
    expect(calls).toEqual([])
    const broken = database([], { claimError: { code: 'PGRST301' } })
    expect(await runBrandBookWrites(broken.db)).toEqual({ ran: 0, failed: 0 })
  })
})

describe('writeFailure', () => {
  it('tries again unless the corrections can never fit', () => {
    expect(writeFailure({ code: 'brand_book_timeout' })).toBe('transient')
    expect(writeFailure({ code: 'PT409' })).toBe('transient')
    expect(writeFailure(null)).toBe('transient')
    expect(writeFailure({ code: 'too_many_corrections' })).toBe('validation')
    expect(writeFailure({ code: '23514' })).toBe('validation')
  })
})

describe('rewriteBrandBookNow', () => {
  it('queues the readers’ rewrite, named once, then runs the workspace’s', async () => {
    const { db, calls } = database([])
    await rewriteBrandBookNow(db, 't1', { cause: 'read', ref: 'j9', ms: 20 })
    expect(calls).toEqual([
      {
        name: 'queue_brand_book_write_as_worker',
        args: { t: 't1', cause: 'read', ref: 'j9' }
      },
      { name: 'claim_brand_book_write', args: { t: 't1' } }
    ])
  })
})

describe('rewriteBrandBookSoon', () => {
  it('runs the workspace’s rewrites after the reply, as the worker, within its deadline', async () => {
    expect(clickDeadlineMs).toBe(25_000)
    expect(clickDeadlineMs - clickWriteMs).toBe(15_000)
    const { db, calls } = database([])
    service.createServiceClient.mockReturnValue(db)
    rewriteBrandBookSoon('t1')
    expect(next.after).toHaveBeenCalledOnce()
    expect(calls).toEqual([])
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
