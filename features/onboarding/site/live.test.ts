// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { classifyFailure } from '@/features/integrations/failures'
import { sampleAsk, TagError } from '@/features/intelligence/passes'
import {
  cappedEnv,
  dbMarginMs,
  jobFailure,
  readersRunMs,
  runSiteReadings,
  siteAsk,
  siteCallTimeoutMs,
  siteRunMs
} from './live'
import { pageTimeoutMs } from './fetch'

describe('jobFailure', () => {
  it('lets the job runner try an AI outage or a rate limit again, and stop on a spent budget', () => {
    const classes = [
      'rate_limited',
      'cap_reached',
      'timeout',
      'unavailable',
      'rejected_request'
    ].map((code) => classifyFailure(jobFailure(new TagError(code))))
    // A spent budget stops: trying again would only be refused again.
    expect(classes).toEqual([
      'rate_limit',
      'validation',
      'transient',
      'transient',
      'validation'
    ])
    const other = new Error('x')
    expect(jobFailure(other)).toBe(other)
  })
})

describe('cappedEnv and siteAsk', () => {
  const env = (values: Record<string, string>) =>
    values as unknown as NodeJS.ProcessEnv
  it('caps every model call of the readers run, keeping a shorter one', () => {
    expect(
      cappedEnv(env({ GEMINI_TIMEOUT_MS: '60000' })).GEMINI_TIMEOUT_MS
    ).toBe(String(siteCallTimeoutMs))
    expect(
      cappedEnv(env({ GEMINI_TIMEOUT_MS: '6000' })).GEMINI_TIMEOUT_MS
    ).toBe('6000')
    // A value the AI setup cannot take (it would fall back to 60 s) is capped.
    for (const odd of ['4000', '7.5', 'soon'])
      expect(cappedEnv(env({ GEMINI_TIMEOUT_MS: odd })).GEMINI_TIMEOUT_MS).toBe(
        String(siteCallTimeoutMs)
      )
    expect(cappedEnv(env({})).GEMINI_TIMEOUT_MS).toBe(String(siteCallTimeoutMs))
  })

  it('uses the sample rules for the sample site, a model for a live one only when set up', () => {
    const db = {} as Parameters<typeof siteAsk>[0]
    const fake = siteAsk(db, 't1', env({ AI_DEFAULT_PROVIDER: 'fake' }))
    expect(fake(false)).toBe(sampleAsk)
    expect(fake(true)).toBeNull()
    const gemini = siteAsk(
      db,
      't1',
      env({ AI_DEFAULT_PROVIDER: 'gemini', GEMINI_API_KEY: 'synthetic' })
    )
    expect(gemini(false)).toBe(sampleAsk)
    expect(gemini(true)).not.toBeNull()
    expect(gemini(true)).not.toBe(sampleAsk)
  })
})

describe('runSiteReadings', () => {
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
      if (name === 'claim_site_reading') {
        const id = queue.shift()
        return { data: id ? [job(id)] : [], error: null }
      }
      return { data: null, error: null }
    })
    return {
      calls,
      db: { rpc } as unknown as Parameters<typeof runSiteReadings>[0]
    }
  }

  it('reads every waiting site, records a failed one on its job, and goes on', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { db, calls } = database(['j1', 'j2', 'j3'])
    const read = vi.fn(async (_db: unknown, j: { id: string }) => {
      if (j.id === 'j2') throw new TagError('unavailable')
    })
    expect(await runSiteReadings(db, { read })).toEqual({
      state: 'done',
      reads: 2,
      failed: 1
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
    })
    expect(await runSiteReadings(db, { read, now: () => now })).toMatchObject({
      reads: 1
    })
    expect(read).toHaveBeenCalledOnce()
  })

  it('never throws: a claim that fails is reported with its code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = {
      rpc: async () => ({ data: null, error: { code: 'PGRST301' } })
    } as unknown as Parameters<typeof runSiteReadings>[0]
    expect(await runSiteReadings(db)).toEqual({
      state: 'failed',
      code: 'PGRST301'
    })
  })
})

describe('the readers run fits its route', () => {
  it('ends inside 60 seconds: start cutoff, one read, one more capped call and the database margin', () => {
    // No read starts after readersRunMs; a read starts no page or model call
    // without the time it may take, so it ends by siteRunMs; one capped
    // Gemini call is counted again as a margin, then the database work.
    expect(
      readersRunMs + siteRunMs + siteCallTimeoutMs + dbMarginMs
    ).toBeLessThanOrEqual(60_000)
    expect(pageTimeoutMs + siteCallTimeoutMs).toBeLessThan(siteRunMs)
  })
})
