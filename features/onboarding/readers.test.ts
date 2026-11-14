// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const jobs = vi.hoisted(() => ({
  site: vi.fn(async () => ({})),
  catalog: vi.fn(async () => ({ outcome: 'paused', reason: 'rate_limited' })),
  history: vi.fn(async () => ({ outcome: 'read' }))
}))
vi.mock('./site/live', async (actual) => ({
  ...(await actual<typeof import('./site/live')>()),
  runSiteReadingJob: jobs.site
}))
vi.mock('./catalog/live', () => ({ runCatalogReadingJob: jobs.catalog }))
vi.mock('./history/live', () => ({ runHistoryReadingJob: jobs.history }))
import { TagError } from '@/features/intelligence/passes'
import { catalogRunMs, klaviyoCallMs } from './catalog/worker'
import { historyRunMs } from './history/worker'
import {
  dbMarginMs,
  readersRunMs,
  runSourceReadingJob,
  runSourceReadings,
  siteCallTimeoutMs,
  sourceRunMs
} from './readers'
import { pageTimeoutMs } from './site/fetch'
import { siteRunMs } from './site/live'

describe('runSourceReadings', () => {
  const job = (id: string) => ({
    id,
    lease_token: `lease-${id}`,
    tenant_id: 't1'
  })
  function database(jobs: string[]) {
    const queue = [...jobs]
    const calls: { name: string; args?: unknown }[] = []
    const rpc = vi.fn(async (name: string, args?: unknown) => {
      calls.push({ name, args })
      if (name === 'claim_source_reading') {
        const id = queue.shift()
        return { data: id ? [job(id)] : [], error: null }
      }
      return { data: null, error: null }
    })
    return {
      calls,
      db: { rpc } as unknown as Parameters<typeof runSourceReadings>[0]
    }
  }

  it('reads every waiting site, records a failed one on its job, and goes on', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { db, calls } = database(['j1', 'j2', 'j3'])
    const read = vi.fn(async (_db: unknown, j: { id: string }) => {
      if (j.id === 'j2') throw new TagError('unavailable')
      return j.id === 'j3' ? ('paused' as const) : ('read' as const)
    })
    expect(await runSourceReadings(db, { read })).toEqual({
      state: 'done',
      reads: 1,
      failed: 1,
      paused: 1
    })
    expect(calls.find((c) => c.name === 'fail_job')?.args).toEqual({
      job: 'j2',
      lease: 'lease-j2',
      failure: 'transient'
    })
  })

  it('takes no new read once its time is up', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    let now = 0
    const { db } = database(['j1', 'j2'])
    const read = vi.fn(async () => {
      now += readersRunMs
      return 'read' as const
    })
    expect(await runSourceReadings(db, { read, now: () => now })).toMatchObject(
      {
        reads: 1
      }
    )
    expect(read).toHaveBeenCalledOnce()
  })

  it('never throws: a claim that fails is reported with its code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = {
      rpc: async () => ({ data: null, error: { code: 'PGRST301' } })
    } as unknown as Parameters<typeof runSourceReadings>[0]
    expect(await runSourceReadings(db)).toEqual({
      state: 'failed',
      code: 'PGRST301'
    })
  })
})

describe('the readers run fits its route', () => {
  it('ends inside 60 seconds: start cutoff, one read, one more capped call and the database margin', () => {
    // No read starts after readersRunMs; a read starts no page, Klaviyo
    // request or model call without the time it may take, so it ends by
    // sourceRunMs; one capped Gemini call is counted again as a margin,
    // then the database work.
    expect(sourceRunMs).toBe(Math.max(siteRunMs, catalogRunMs, historyRunMs))
    expect(
      readersRunMs + sourceRunMs + siteCallTimeoutMs + dbMarginMs
    ).toBeLessThanOrEqual(60_000)
    expect(pageTimeoutMs + siteCallTimeoutMs).toBeLessThan(siteRunMs)
    expect(klaviyoCallMs + siteCallTimeoutMs).toBeLessThan(catalogRunMs)
    expect(klaviyoCallMs + siteCallTimeoutMs).toBeLessThan(historyRunMs)
  })
})

describe('runSourceReadingJob', () => {
  it('reads each kind of job as its own source: a site, a catalog, a history', async () => {
    const db = {} as Parameters<typeof runSourceReadingJob>[0]
    const job = (kind: string) =>
      ({ id: 'j', kind }) as Parameters<typeof runSourceReadingJob>[1]
    expect(await runSourceReadingJob(db, job('brand.read_site'))).toBe('read')
    expect(jobs.site).toHaveBeenCalledOnce()
    expect(await runSourceReadingJob(db, job('brand.read_catalog'))).toBe(
      'paused'
    )
    expect(jobs.catalog).toHaveBeenCalledOnce()
    expect(await runSourceReadingJob(db, job('brand.read_history'))).toBe(
      'read'
    )
    expect(jobs.history).toHaveBeenCalledOnce()
  })
})
