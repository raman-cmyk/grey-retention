// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const jobs = vi.hoisted(() => ({
  site: vi.fn(async () => ({})),
  catalog: vi.fn(async () => ({ outcome: 'paused', reason: 'rate_limited' })),
  history: vi.fn(async () => ({ outcome: 'read' })),
  ads: vi.fn(async () => ({ state: 'ready' })),
  reviews: vi.fn(async () => ({ analysis: 'done' }))
}))
vi.mock('./site/live', async (actual) => ({
  ...(await actual<typeof import('./site/live')>()),
  runSiteReadingJob: jobs.site
}))
vi.mock('./catalog/live', () => ({ runCatalogReadingJob: jobs.catalog }))
vi.mock('./history/live', () => ({ runHistoryReadingJob: jobs.history }))
vi.mock('./ads/live', () => ({ runAdsReadingJob: jobs.ads }))
vi.mock('./reviews/live', () => ({ runReviewsReadingJob: jobs.reviews }))
import { TagError } from '@/features/intelligence/passes'
import { catalogRunMs, klaviyoCallMs } from './catalog/worker'
import { adsRunMs, libraryMs } from './ads/worker'
import { historyRunMs } from './history/worker'
import { reviewsRunMs, reviewsSourceMs, socialSourceMs } from './reviews/worker'
import {
  bookMs,
  dbMarginMs,
  readersRunMs,
  routeMs,
  runSourceReadingJob,
  runSourceReadings,
  siteCallTimeoutMs,
  sourceRunMs
} from './readers'
import { strategistCallMs } from './strategist-run'
import { pageTimeoutMs } from './site/fetch'
import { siteRunMs } from './site/live'

describe('runSourceReadings', () => {
  // No Brand book work unless a test asks for it.
  const noBooks = { book: async () => null, staleBooks: async () => [] }
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
    expect(await runSourceReadings(db, { read, ...noBooks })).toEqual({
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
    expect(
      await runSourceReadings(db, { read, now: () => now, ...noBooks })
    ).toMatchObject({
      reads: 1
    })
    expect(read).toHaveBeenCalledOnce()
  })

  it('writes the Brand book after a read, never after a pause or a failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { db } = database(['j1', 'j2', 'j3'])
    const read = vi.fn(async (_db: unknown, j: { id: string }) => {
      if (j.id === 'j2') throw new TagError('unavailable')
      return j.id === 'j3' ? ('paused' as const) : ('read' as const)
    })
    const book = vi.fn(async () => 1)
    await runSourceReadings(db, { read, book, staleBooks: async () => [] })
    expect(book).toHaveBeenCalledOnce()
    expect(book).toHaveBeenCalledWith(db, 't1')
  })

  it('asks the Brand strategist once, after the reads, when its call still ends inside the route (ONB-106c)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const order: string[] = []
    const { db } = database(['j1'])
    const strategist = vi.fn(async (_db: unknown, t: string) => {
      order.push(`strategist ${t}`)
      return 'saved'
    })
    const strategyNeeded = vi.fn(async () => ['t7', 't8'])
    await runSourceReadings(db, {
      ...noBooks,
      read: async () => {
        order.push('read')
        return 'read' as const
      },
      strategist,
      strategyNeeded
    })
    expect(order).toEqual(['read', 'strategist t7'])
    expect(strategist).toHaveBeenCalledWith(db, 't7')
    // Not when the call would end past the route's limit.
    let now = 0
    const late = database(['j1'])
    const lateStrategist = vi.fn(async () => 'saved')
    await runSourceReadings(late.db, {
      ...noBooks,
      now: () => now,
      read: async () => {
        now = routeMs - strategistCallMs - dbMarginMs + 1
        return 'read' as const
      },
      strategist: lateStrategist,
      strategyNeeded
    })
    expect(lateStrategist).not.toHaveBeenCalled()
  })

  it('looks for a strategy to write only with a live plan model, never on the fake AI (ONB-106c)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const read = async () => 'read' as const
    const needed = vi.fn(async () => [] as string[])
    for (const env of [
      { AI_DEFAULT_PROVIDER: 'fake', GEMINI_API_KEY: 'k' },
      {}
    ])
      await runSourceReadings(database(['j1']).db, {
        ...noBooks,
        read,
        env: env as unknown as NodeJS.ProcessEnv,
        strategyNeeded: needed
      })
    expect(needed).not.toHaveBeenCalled()
    await runSourceReadings(database(['j1']).db, {
      ...noBooks,
      read,
      env: { GEMINI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv,
      strategyNeeded: needed
    })
    expect(needed).toHaveBeenCalledOnce()
  })

  it('checks the time again after the lookup, before the strategist’s call (ONB-106c)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    let now = 0
    const strategist = vi.fn(async () => 'saved')
    await runSourceReadings(database(['j1']).db, {
      ...noBooks,
      now: () => now,
      read: async () => 'read' as const,
      strategist,
      strategyNeeded: async () => {
        now = routeMs - strategistCallMs - dbMarginMs
        return ['t1']
      }
    })
    expect(strategist).not.toHaveBeenCalled()
  })

  it('goes on when the strategist or its lookup fails, and never asks it with nothing to do (ONB-106c)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const read = async () => 'read' as const
    const broken = vi.fn(async () => {
      throw Object.assign(new Error('down'), { code: '42501' })
    })
    expect(
      await runSourceReadings(database(['j1']).db, {
        ...noBooks,
        read,
        strategist: broken,
        strategyNeeded: async () => ['t1']
      })
    ).toMatchObject({ state: 'done', reads: 1 })
    expect(broken).toHaveBeenCalledOnce()
    const idle = vi.fn(async () => 'saved')
    expect(
      await runSourceReadings(database([]).db, {
        ...noBooks,
        read,
        strategist: idle,
        strategyNeeded: async () => {
          throw Object.assign(new Error('down'), { code: 'XX000' })
        }
      })
    ).toMatchObject({ state: 'done' })
    await runSourceReadings(database([]).db, {
      ...noBooks,
      read,
      strategist: idle,
      strategyNeeded: async () => []
    })
    expect(idle).not.toHaveBeenCalled()
  })

  it('writes no Brand book that would not end inside the route, and goes on when one fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let now = 0
    const late = database(['j1'])
    const book = vi.fn(async () => 1)
    await runSourceReadings(late.db, {
      book,
      staleBooks: async () => [],
      now: () => now,
      read: async () => {
        now = routeMs - bookMs - dbMarginMs + 1
        return 'read' as const
      }
    })
    expect(book).not.toHaveBeenCalled()
    const failing = database(['j1', 'j2'])
    const broken = vi.fn(async () => {
      throw Object.assign(new Error('down'), { code: '42501' })
    })
    expect(
      await runSourceReadings(failing.db, {
        book: broken,
        staleBooks: async () => [],
        read: async () => 'read' as const
      })
    ).toMatchObject({ state: 'done', reads: 2 })
    expect(broken).toHaveBeenCalledTimes(2)
  })

  it('first writes the books a skipped write left behind, and never waits too long for one', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db } = database(['j1'])
    const order: string[] = []
    const book = vi.fn(async (_db: unknown, t: string) => {
      order.push(`book ${t}`)
      // One write never answers: the run goes on after bookMs.
      if (t === 'stuck') return new Promise(() => {})
      return 1
    })
    const read = vi.fn(async () => {
      order.push('read')
      return 'read' as const
    })
    expect(
      await runSourceReadings(db, {
        read,
        book,
        bookMs: 20,
        staleBooks: async () => ['stuck', 'old']
      })
    ).toMatchObject({ state: 'done', reads: 1 })
    expect(order).toEqual(['book stuck', 'book old', 'read', 'book t1'])
    // A stale-book check that fails changes nothing.
    const again = database(['j1'])
    expect(
      await runSourceReadings(again.db, {
        read: async () => 'read' as const,
        book: async () => 1,
        staleBooks: async () => {
          throw new Error('down')
        }
      })
    ).toMatchObject({ state: 'done', reads: 1 })
  })

  it('leaves time for a Brand book inside the route', () => {
    expect(
      readersRunMs + sourceRunMs + siteCallTimeoutMs + dbMarginMs
    ).toBeLessThanOrEqual(routeMs)
    expect(bookMs + dbMarginMs).toBeLessThan(routeMs - readersRunMs)
  })

  it('never throws: a claim that fails is reported with its code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = {
      rpc: async () => ({ data: null, error: { code: 'PGRST301' } })
    } as unknown as Parameters<typeof runSourceReadings>[0]
    expect(await runSourceReadings(db, noBooks)).toEqual({
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
    expect(sourceRunMs).toBe(
      Math.max(siteRunMs, catalogRunMs, historyRunMs, adsRunMs, reviewsRunMs)
    )
    expect(
      readersRunMs + sourceRunMs + siteCallTimeoutMs + dbMarginMs
    ).toBeLessThanOrEqual(60_000)
    expect(pageTimeoutMs + siteCallTimeoutMs).toBeLessThan(siteRunMs)
    expect(klaviyoCallMs + siteCallTimeoutMs).toBeLessThan(catalogRunMs)
    expect(klaviyoCallMs + siteCallTimeoutMs).toBeLessThan(historyRunMs)
    expect(libraryMs + siteCallTimeoutMs).toBeLessThan(adsRunMs)
    expect(
      Math.max(reviewsSourceMs, socialSourceMs) + siteCallTimeoutMs
    ).toBeLessThan(reviewsRunMs)
  })
})

describe('runSourceReadingJob', () => {
  it('reads each kind of job as its own source: a site, a catalog, a history, ads, reviews', async () => {
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
    expect(await runSourceReadingJob(db, job('brand.read_ads'))).toBe('read')
    expect(jobs.ads).toHaveBeenCalledOnce()
    expect(await runSourceReadingJob(db, job('brand.read_reviews'))).toBe(
      'read'
    )
    expect(jobs.reviews).toHaveBeenCalledOnce()
  })
})
