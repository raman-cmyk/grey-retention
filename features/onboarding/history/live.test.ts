// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const worker = vi.hoisted(() => ({ readBrandHistory: vi.fn() }))
vi.mock('./worker', async (actual) => ({
  ...(await actual<typeof import('./worker')>()),
  readBrandHistory: worker.readBrandHistory
}))
import { ProviderFault } from '@/features/integrations/failures'
import { sampleAsk } from '@/features/intelligence/passes'
import { KlaviyoError } from '@/lib/providers/klaviyo/client'
import { runHistoryReadingJob } from './live'
import { startHistoryReading } from './start'

type Db = Parameters<typeof runHistoryReadingJob>[0]
type Job = Parameters<typeof runHistoryReadingJob>[1]
const job = {
  id: 'job-1',
  tenant_id: 'tenant-1',
  lease_token: 'lease-1',
  kind: 'brand.read_history',
  input: { mode: 'fixture' }
} as unknown as Job

function database(synthetic = true) {
  const rpc = vi.fn(async () => ({ data: null, error: null }))
  const from = () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({
        data: { mode: 'fixture', status: 'connected' },
        error: null
      }),
      single: async () => ({
        data: { domain: 'cedar-lane.example', synthetic },
        error: null
      })
    }
    return chain
  }
  return { rpc, db: { from, rpc } as unknown as Db }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  worker.readBrandHistory.mockReset()
})

describe('runHistoryReadingJob', () => {
  it('reads the recorded sample account for a synthetic brand, with the sample rules and capped calls', async () => {
    worker.readBrandHistory.mockImplementation(async (_db, _job, deps) => {
      // The sample account answers: it is the recorded history, not a real one.
      const body = (await deps.client.get(
        '/api/segments?fields[segment]=name,is_active,is_starred&page[size]=10',
        'segments:read'
      )) as { data: unknown[] }
      return { state: 'ready', audiences: body.data.length }
    })
    const { db } = database()
    expect(
      await runHistoryReadingJob(db, job, {} as NodeJS.ProcessEnv)
    ).toEqual({
      outcome: 'read',
      state: 'ready',
      audiences: 3
    })
    expect(worker.readBrandHistory.mock.calls[0]![2]).toMatchObject({
      live: false,
      ask: sampleAsk,
      callMs: 10_000
    })
  })

  it('never reads the sample account for a real brand', async () => {
    await expect(
      runHistoryReadingJob(database(false).db, job, {} as NodeJS.ProcessEnv)
    ).rejects.toBeInstanceOf(ProviderFault)
    expect(worker.readBrandHistory).not.toHaveBeenCalled()
  })

  it('pauses on Klaviyo the same way as a catalog read', async () => {
    worker.readBrandHistory.mockRejectedValue(
      new KlaviyoError('rate_limited', {
        endpoint: '/api/campaign-values-reports/',
        retryAfterSeconds: 30
      })
    )
    const { db, rpc } = database()
    expect(
      await runHistoryReadingJob(db, job, {} as NodeJS.ProcessEnv)
    ).toEqual({ outcome: 'paused', reason: 'rate_limited' })
    expect(rpc).toHaveBeenCalledWith('pause_source_reading', {
      job: 'job-1',
      lease: 'lease-1',
      reason: 'rate_limited',
      seconds: 30
    })
    worker.readBrandHistory.mockRejectedValue(
      new KlaviyoError('unavailable', { endpoint: '/api/flows/' })
    )
    await expect(
      runHistoryReadingJob(db, job, {} as NodeJS.ProcessEnv)
    ).rejects.toMatchObject({ failure: 'transient' })
  })
})

describe('startHistoryReading', () => {
  it("starts the owner's history read, or says what is missing", async () => {
    const answering = (answer: {
      data: unknown
      error: { code: string } | null
    }) => {
      const rpc = vi.fn(async () => answer)
      return {
        rpc,
        db: { rpc } as unknown as Parameters<typeof startHistoryReading>[0]
      }
    }
    const ok = answering({ data: 'job-1', error: null })
    expect(await startHistoryReading(ok.db, 't')).toEqual({
      ok: true,
      jobId: 'job-1'
    })
    expect(ok.rpc).toHaveBeenCalledWith('start_history_reading', { t: 't' })
    for (const [code, said] of [
      ['23514', 'connect_klaviyo'],
      ['42501', 'access_denied'],
      ['XX000', 'unavailable']
    ] as const)
      expect(
        await startHistoryReading(
          answering({ data: null, error: { code } }).db,
          't'
        )
      ).toEqual({ ok: false, code: said })
  })
})
