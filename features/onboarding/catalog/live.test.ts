// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const worker = vi.hoisted(() => ({ readBrandCatalog: vi.fn() }))
vi.mock('./worker', async (actual) => ({
  ...(await actual<typeof import('./worker')>()),
  readBrandCatalog: worker.readBrandCatalog
}))
const client = vi.hoisted(() => ({ options: [] as unknown[] }))
vi.mock('@/lib/providers/klaviyo/client', async (actual) => {
  const real = await actual<typeof import('@/lib/providers/klaviyo/client')>()
  return {
    ...real,
    klaviyoClient: (key: string, options: unknown) => {
      client.options.push(options)
      return real.klaviyoClient(key, options as never)
    }
  }
})
import { ProviderFault } from '@/features/integrations/failures'
import { sampleAsk } from '@/features/intelligence/passes'
import { KlaviyoError } from '@/lib/providers/klaviyo/client'
import {
  catalogSourceFor,
  runCatalogReadingJob,
  sampleKlaviyoKey
} from './live'

type Db = Parameters<typeof catalogSourceFor>[0]
type Job = Parameters<typeof catalogSourceFor>[1]
const jobOf = (mode: string) =>
  ({
    id: 'job-1',
    tenant_id: 'tenant-1',
    lease_token: 'lease-1',
    kind: 'brand.read_catalog',
    input: { mode }
  }) as unknown as Job

function database(state: {
  connection?: { mode: string; status: string } | null
  synthetic?: boolean
  key?: string | null
}) {
  const rpc = vi.fn(async (name: string, args?: unknown) => {
    void args
    if (name === 'klaviyo_api_key')
      return { data: state.key ?? null, error: null }
    return { data: null, error: null }
  })
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({
        data:
          table === 'workspace_connections' ? (state.connection ?? null) : null,
        error: null
      }),
      single: async () => ({
        data: {
          domain: 'www.Cedar-Lane.example',
          synthetic: state.synthetic ?? true
        },
        error: null
      })
    }
    return chain
  }
  return { rpc, db: { from, rpc } as unknown as Db }
}
const live = { KLAVIYO_MODE: 'live' } as unknown as NodeJS.ProcessEnv
const off = {} as NodeJS.ProcessEnv

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  worker.readBrandCatalog.mockReset()
})

describe('catalogSourceFor', () => {
  it("reads a live connection with its stored key, only with the owner's switch on", async () => {
    const connected = {
      connection: { mode: 'live', status: 'connected' },
      key: 'pk_LIVE0123456789abcdefghijk'
    }
    const on = database(connected)
    const source = await catalogSourceFor(on.db, jobOf('live'), live)
    expect(source).toMatchObject({ live: true })
    expect(on.rpc).toHaveBeenCalledWith('klaviyo_api_key', { t: 'tenant-1' })
    const switchedOff = database(connected)
    expect(await catalogSourceFor(switchedOff.db, jobOf('live'), off)).toEqual({
      reason: 'klaviyo_off'
    })
    // The key is never read while the switch is off.
    expect(switchedOff.rpc).not.toHaveBeenCalled()
    expect(
      await catalogSourceFor(database(connected).db, jobOf('live'), {
        KLAVIYO_MODE: 'live',
        KLAVIYO_API_REVISION: '2025-01-15'
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual({ reason: 'klaviyo_revision' })
    expect(
      await catalogSourceFor(
        database({ ...connected, key: null }).db,
        jobOf('live'),
        live
      )
    ).toEqual({ reason: 'no_key' })
  })

  it('reads the sample store only for a synthetic brand, on its own domain', async () => {
    const sample = await catalogSourceFor(
      database({ connection: { mode: 'fixture', status: 'connected' } }).db,
      jobOf('fixture'),
      live
    )
    expect(sample).toMatchObject({ live: false })
    const answer = (await (
      sample as {
        client: { get: (p: string, s: 'metrics:read') => Promise<unknown> }
      }
    ).client.get(
      '/api/metrics?fields[metric]=name,integration',
      'metrics:read'
    )) as { data: unknown[] }
    expect(answer.data.length).toBeGreaterThan(0)
    expect(
      await catalogSourceFor(
        database({
          connection: { mode: 'fixture', status: 'connected' },
          synthetic: false
        }).db,
        jobOf('fixture'),
        live
      )
    ).toEqual({ reason: 'not_sample' })
    expect(sampleKlaviyoKey).toMatch(/^pk_[A-Za-z0-9]{20,64}$/)
  })

  it('reads nothing once the connection changed, went away or needs attention', async () => {
    for (const connection of [
      null,
      { mode: 'fixture', status: 'connected' },
      { mode: 'live', status: 'expired' }
    ])
      expect(
        await catalogSourceFor(
          database({ connection, key: 'pk_x' }).db,
          jobOf('live'),
          live
        )
      ).toEqual({ reason: 'connection_changed' })
  })
})

describe('runCatalogReadingJob', () => {
  const sample = () =>
    database({ connection: { mode: 'fixture', status: 'connected' } })

  it('reads with the capped calls and the sample rules for the sample store', async () => {
    worker.readBrandCatalog.mockResolvedValue({ state: 'ready', products: 3 })
    const { db } = sample()
    expect(await runCatalogReadingJob(db, jobOf('fixture'), off)).toEqual({
      outcome: 'read',
      state: 'ready',
      products: 3
    })
    const deps = worker.readBrandCatalog.mock.calls[0]![2]
    expect(deps).toMatchObject({ live: false, ask: sampleAsk, callMs: 10_000 })
  })

  it('puts the job back when Klaviyo asks to wait, for as long as it says, without using a try', async () => {
    worker.readBrandCatalog.mockRejectedValue(
      new KlaviyoError('rate_limited', {
        endpoint: '/api/events/',
        retryAfterSeconds: 120
      })
    )
    const { db, rpc } = sample()
    expect(await runCatalogReadingJob(db, jobOf('fixture'), off)).toEqual({
      outcome: 'paused',
      reason: 'rate_limited'
    })
    expect(rpc).toHaveBeenCalledWith('pause_source_reading', {
      job: 'job-1',
      lease: 'lease-1',
      reason: 'rate_limited',
      seconds: 120
    })
  })

  it('stops and tells the owner on a refused key or a missing scope', async () => {
    for (const [kind, reason] of [
      ['bad_key', 'klaviyo_key_rejected'],
      ['missing_scope', 'klaviyo_scope_missing']
    ] as const) {
      worker.readBrandCatalog.mockRejectedValue(
        new KlaviyoError(kind, { endpoint: '/api/catalog-items/', status: 401 })
      )
      const { db, rpc } = sample()
      expect(await runCatalogReadingJob(db, jobOf('fixture'), off)).toEqual({
        outcome: 'paused',
        reason
      })
      expect(rpc).toHaveBeenCalledWith('pause_source_reading', {
        job: 'job-1',
        lease: 'lease-1',
        reason
      })
    }
  })

  it('tries an outage again, and stops on anything else', async () => {
    worker.readBrandCatalog.mockRejectedValue(
      new KlaviyoError('unavailable', { endpoint: '/api/events/' })
    )
    await expect(
      runCatalogReadingJob(sample().db, jobOf('fixture'), off)
    ).rejects.toMatchObject({
      failure: 'transient'
    })
    worker.readBrandCatalog.mockRejectedValue(
      new KlaviyoError('invalid_response', { endpoint: '/api/accounts/' })
    )
    await expect(
      runCatalogReadingJob(sample().db, jobOf('fixture'), off)
    ).rejects.toMatchObject({
      failure: 'validation'
    })
  })

  it('starts no read, and calls no one, when the connection is not the one asked for', async () => {
    const { db } = database({
      connection: { mode: 'live', status: 'connected' }
    })
    await expect(
      runCatalogReadingJob(db, jobOf('live'), off)
    ).rejects.toBeInstanceOf(ProviderFault)
    expect(worker.readBrandCatalog).not.toHaveBeenCalled()
  })
})

describe('the live client and the logs', () => {
  it('asks Klaviyo with every request capped and no rate limit waited out', async () => {
    client.options.length = 0
    const { db } = database({
      connection: { mode: 'live', status: 'connected' },
      key: 'pk_LIVE0123456789abcdefghijk'
    })
    await catalogSourceFor(db, jobOf('live'), live)
    expect(client.options).toEqual([{ maxWaits: 0, timeoutMs: 6_000 }])
  })

  it('logs what Klaviyo said, never the key', async () => {
    const lines: string[] = []
    for (const level of ['log', 'warn', 'error', 'info'] as const)
      vi.spyOn(console, level).mockImplementation((...args) => {
        lines.push(args.map(String).join(' '))
      })
    worker.readBrandCatalog.mockRejectedValue(
      new KlaviyoError('rejected', {
        endpoint: '/api/events/',
        status: 400,
        code: 'invalid'
      })
    )
    const { db } = database({
      connection: { mode: 'live', status: 'connected' },
      key: 'pk_LIVE0123456789abcdefghijk'
    })
    await expect(
      runCatalogReadingJob(db, jobOf('live'), live)
    ).rejects.toBeInstanceOf(ProviderFault)
    const text = lines.join('\n')
    expect(text).toContain('Klaviyo failed')
    expect(text).toContain('/api/events/')
    expect(text).toContain('invalid')
    expect(text).not.toContain('pk_LIVE0123456789abcdefghijk')
  })
})
