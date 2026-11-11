// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { sampleAsk, type Ask, type AiRun } from '@/features/intelligence/passes'
import {
  klaviyoClient,
  type KlaviyoResponse
} from '@/lib/providers/klaviyo/client'
import { recorded } from '@/lib/providers/klaviyo/recorded'
import {
  recordedCatalogTransport,
  type CatalogStore
} from '@/lib/providers/klaviyo/recorded-catalog'
import type { CatalogRecord } from './clean'
import { catalogRunMs, readBrandCatalog } from './worker'

type Db = Parameters<typeof readBrandCatalog>[0]
type Job = Parameters<typeof readBrandCatalog>[1]
const job = {
  id: 'job-1',
  tenant_id: 'tenant-1',
  lease_token: 'lease-1',
  kind: 'brand.read_catalog',
  input: { mode: 'fixture' }
} as unknown as Job
const now = Date.parse('2026-11-11T12:00:00Z')

function database() {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { brand_name: 'Cedar Goods' }, error: null })
  }
  return {
    calls,
    db: {
      from: () => chain,
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return { data: {}, error: null }
      })
    } as unknown as Db
  }
}
type Recorded = {
  products: CatalogRecord[]
  findings: {
    topic: string
    value: unknown
    pass: string
    evidence: unknown
    model: string | null
    statement: string
  }[]
  summary: Record<string, unknown>
  live: boolean
}
const recordedOf = (calls: ReturnType<typeof database>['calls']) =>
  calls.find((c) => c.name === 'record_catalog_reading')!
    .args as unknown as Recorded

const read = async (
  options: {
    store?: CatalogStore
    fail?: NonNullable<Parameters<typeof recordedCatalogTransport>[0]>['fail']
    live?: boolean
    ask?: Ask | null
    clock?: () => number
  } = {}
) => {
  const transport = recordedCatalogTransport({
    store: options.store ?? 'shopify',
    now: new Date(now),
    fail: options.fail
  })
  const { db, calls } = database()
  const run = await readBrandCatalog(db, job, {
    client: klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
      transport,
      maxWaits: 0
    }),
    live: options.live ?? false,
    ask: options.ask === undefined ? sampleAsk : options.ask,
    callMs: 10_000,
    now: options.clock ?? (() => now)
  })
  return { run, calls, transport, stored: recordedOf(calls) }
}
const gemini =
  (content: unknown): Ask =>
  async () =>
    ({
      ok: true,
      content,
      provider: 'gemini',
      model: 'gemini-2.5-flash'
    }) as AiRun

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('readBrandCatalog', () => {
  it("builds a Shopify store's catalog from its events, cleans it and stores it at once", async () => {
    const { run, stored, transport } = await read()
    expect(stored.summary).toEqual({
      state: 'ready',
      source: 'events',
      currency: 'USD',
      currencyCheck: 'matched',
      complete: true,
      // What was read: 90 days, 5 orders and both pages of views.
      window: {
        since: '2026-08-13T12:00:00.000Z',
        orders: 5,
        views: 11,
        oldestOrder: expect.any(String),
        oldestView: expect.any(String)
      }
    })
    expect(stored.live).toBe(false)
    const byId = new Map(stored.products.map((p) => [p.externalId, p]))
    expect(byId.get('7001')).toMatchObject({
      title: 'Field Overshirt',
      priceMinor: 6900,
      compareAtIsSale: true,
      featurable: true,
      bestsellerRank: 1
    })
    // The sample rules found the tote listed twice; the copy is hidden.
    expect(byId.get('7006')).toMatchObject({
      featurable: false,
      hiddenReason: 'duplicate'
    })
    expect(byId.get('7004')).toMatchObject({ hiddenReason: 'no_image' })
    expect(run).toMatchObject({
      state: 'ready',
      source: 'events',
      products: 6,
      featurable: 4,
      analysis: 'done'
    })
    // Klaviyo was only read: the account, the catalog, the metrics, the orders, the views.
    expect(transport.calls.map((c) => c.split('?')[0])).toEqual([
      'GET /api/accounts',
      'GET /api/catalog-items',
      'GET /api/metrics',
      'GET /api/events',
      'GET /api/events/',
      'GET /api/events'
    ])
    // The views first (both pages, through Klaviyo's next link), then the orders.
    expect(transport.calls[3]).toContain('metric_id,"VwdPrd"')
    expect(transport.calls[4]).toContain('page[cursor]=views2')
    expect(transport.calls[5]).toContain('metric_id,"PlcdOr"')
    expect(transport.calls.every((c) => c.startsWith('GET '))).toBe(true)
  })

  it('writes what the catalog says for the Brand strategist, each citing Klaviyo', async () => {
    const { stored } = await read()
    expect(stored.findings).toEqual([
      expect.objectContaining({
        topic: 'price_band',
        statement: 'Most products cost between $18.50 and $120.00.',
        value: { min: 18.5, max: 120, currency: 'USD' },
        evidence: { ref: 'klaviyo:events' },
        pass: 'sample'
      }),
      expect.objectContaining({
        topic: 'locale',
        value: { language: 'en', currency: 'USD' },
        evidence: { ref: 'klaviyo:account' },
        statement: 'The store sells in USD, in English.'
      }),
      expect.objectContaining({
        topic: 'offering',
        statement:
          'Sells products such as Field Overshirt, Canvas Tote and Weekend Knit.',
        pass: 'sample',
        model: null
      })
    ])
  })

  it('reads a catalog sent to Klaviyo directly, with its variants and sales by its own ids', async () => {
    const { stored, transport } = await read({ store: 'custom' })
    // One catalog record could not be read: the read is not whole, so it
    // retires nothing.
    expect(stored.summary).toMatchObject({ source: 'api', complete: false })
    expect(
      stored.products.map((p) => [
        p.externalId,
        p.units90d,
        p.stock,
        p.hiddenReason
      ])
    ).toEqual([
      ['CG-OVERSHIRT', 2, 11, null],
      ['CG-TOTE', 1, null, null],
      ['CG-SCARF', 0, null, 'unpublished']
    ])
    // The catalog was readable: no views were needed.
    expect(transport.calls.filter((c) => c.includes('VwdPrd'))).toEqual([])
    expect(stored.findings[0]).toMatchObject({
      evidence: { ref: 'klaviyo:catalog' }
    })
  })

  it('marks a store with no products as having none, and logs it (D16)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { stored, run } = await read({ store: 'empty' })
    expect(stored).toMatchObject({
      products: [],
      findings: [],
      summary: { state: 'empty', currency: 'USD', reason: 'no_products' }
    })
    expect(stored.summary).not.toHaveProperty('source')
    expect(run).toMatchObject({ state: 'empty', analysis: 'skipped' })
    expect(warn.mock.calls.flat().join(' ')).toContain('no products')
  })

  it('uses the events when the key cannot read the catalog, never stopping the connection for it', async () => {
    const { stored } = await read({
      store: 'custom',
      fail: { on: 'catalog', with: recorded.noScope }
    })
    expect(stored.summary).toMatchObject({ source: 'events', complete: false })
  })

  it('stops, storing nothing, when products were found but none could be stored', async () => {
    const noPages: KlaviyoResponse = {
      status: 200,
      headers: {},
      body: JSON.stringify({
        data: [
          {
            type: 'event',
            attributes: {
              datetime: '2026-11-10T10:00:00+00:00',
              event_properties: {
                Name: 'Field Overshirt',
                ProductID: 1,
                Price: '$89.00'
              }
            }
          }
        ],
        links: { next: null }
      })
    }
    const transport = recordedCatalogTransport({
      now: new Date(now),
      fail: { on: 'views', with: noPages }
    })
    const { db, calls } = database()
    await expect(
      readBrandCatalog(db, job, {
        client: klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
          transport,
          maxWaits: 0
        }),
        live: false,
        ask: sampleAsk,
        callMs: 10_000,
        now: () => now
      })
    ).rejects.toMatchObject({ code: 'no_storable_product' })
    expect(calls.map((c) => c.name)).not.toContain('record_catalog_reading')
  })

  it('features nothing and states no locale when the orders are in another currency', async () => {
    const eur: KlaviyoResponse = {
      ...recorded.account,
      body: recorded.account.body.replace('"USD"', '"EUR"')
    }
    const { stored } = await read({ fail: { on: 'account', with: eur } })
    expect(stored.summary).toMatchObject({
      currency: 'EUR',
      currencyCheck: 'mismatch',
      reason: 'currency_mismatch'
    })
    expect(stored.products.some((p) => p.featurable)).toBe(false)
    // No price band in a currency the prices may not be in, and no locale.
    expect(stored.findings.map((f) => f.topic)).toEqual(['offering'])
  })

  it('uses the events when Klaviyo refuses the catalog request (a changed address), and says the read is not whole', async () => {
    const { stored } = await read({
      store: 'custom',
      fail: {
        on: 'catalog',
        with: {
          status: 400,
          headers: {},
          body: '{"errors":[{"code":"invalid"}]}'
        }
      }
    })
    expect(stored.summary).toMatchObject({ source: 'events', complete: false })
  })

  it('stops for Klaviyo to pause the job on a refused key, a missing scope or a rate limit, storing nothing', async () => {
    for (const [response, kind] of [
      [recorded.badKey, 'bad_key'],
      [recorded.noScope, 'missing_scope'],
      [recorded.throttled(30), 'rate_limited']
    ] as const) {
      const transport = recordedCatalogTransport({
        now: new Date(now),
        fail: { on: 'orders', with: response }
      })
      const { db, calls } = database()
      await expect(
        readBrandCatalog(db, job, {
          client: klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
            transport,
            maxWaits: 0
          }),
          live: false,
          ask: sampleAsk,
          callMs: 10_000,
          now: () => now
        })
      ).rejects.toMatchObject({ kind })
      expect(calls.map((c) => c.name)).not.toContain('record_catalog_reading')
    }
  })

  const slowAfter = (part: string, left: number) => {
    const state = { clock: now }
    const answers = recordedCatalogTransport({ now: new Date(now) })
    const slow = (async (request) => {
      const answer = await answers(request)
      if (decodeURIComponent(request.url).includes(part))
        state.clock = now + catalogRunMs - left
      return answer
    }) as typeof answers
    return { state, answers, slow }
  }

  it('never calls a store with nothing read yet "no products": it tries again later, replacing nothing', async () => {
    // The catalog answer takes most of the run's time.
    const { state, answers, slow } = slowAfter('/api/catalog-items', 12_000)
    const { db, calls } = database()
    await expect(
      readBrandCatalog(db, job, {
        client: klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
          transport: slow,
          maxWaits: 0
        }),
        live: false,
        ask: sampleAsk,
        callMs: 10_000,
        now: () => state.clock
      })
    ).rejects.toMatchObject({ kind: 'unavailable' })
    expect(calls.map((c) => c.name)).not.toContain('record_catalog_reading')
    // No Klaviyo page without the time for it and the analyst's call.
    expect(answers.calls.map((c) => c.split('?')[0])).toEqual([
      'GET /api/accounts',
      'GET /api/catalog-items'
    ])
  })

  it('reads the views before the orders, and stores what it read in time as an incomplete read', async () => {
    const { state, answers, slow } = slowAfter('metric_id,"VwdPrd"', 12_000)
    const { db, calls } = database()
    const done = await readBrandCatalog(db, job, {
      client: klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
        transport: slow,
        maxWaits: 0
      }),
      live: false,
      ask: sampleAsk,
      callMs: 10_000,
      now: () => state.clock
    })
    expect(done).toMatchObject({ state: 'ready', complete: false })
    expect(recordedOf(calls).summary).toMatchObject({
      complete: false,
      window: { orders: 0, views: 6 }
    })
    expect(answers.calls.map((c) => c.split('?')[0])).toEqual([
      'GET /api/accounts',
      'GET /api/catalog-items',
      'GET /api/metrics',
      'GET /api/events'
    ])
  })

  it('for a live store with no model set up, stores the counted facts as code and no words', async () => {
    const { stored, run } = await read({ live: true, ask: null })
    expect(run.analysis).toBe('skipped')
    expect(stored.findings.map((f) => [f.topic, f.pass])).toEqual([
      ['price_band', 'code'],
      ['locale', 'code']
    ])
    // Without the analyst, the copy of the tote is not known to be one.
    expect(
      stored.products.find((p) => p.externalId === '7006')!.hiddenReason
    ).toBeNull()
  })

  it("takes a live model's checked answer: alike duplicates only, and a sentence without numbers or claims", async () => {
    const { stored } = await read({
      live: true,
      ask: gemini({
        duplicates: [
          { keep: '7006', drop: '7003' },
          { keep: '7001', drop: '7002' }
        ],
        offering: {
          statement: 'Sells menswear basics: overshirts, knitwear and bags.',
          confidence: 0.97
        }
      })
    })
    const hidden = stored.products
      .filter((p) => p.hiddenReason === 'duplicate')
      .map((p) => p.externalId)
    // The tote that sold more is kept; an overshirt is never a knit.
    expect(hidden).toEqual(['7006'])
    expect(stored.findings.find((f) => f.topic === 'offering')).toMatchObject({
      statement: 'Sells menswear basics: overshirts, knitwear and bags.',
      pass: 'model',
      model: 'gemini-2.5-flash'
    })
    const bragging = await read({
      live: true,
      ask: gemini({
        duplicates: [],
        offering: {
          statement: 'The best menswear, 50% off today.',
          confidence: 0.9
        }
      })
    })
    expect(bragging.stored.findings.map((f) => f.topic)).not.toContain(
      'offering'
    )
  })

  it('stores the catalog without the analysis when the model fails', async () => {
    for (const ask of [
      (async () => ({ ok: false, code: 'unavailable' })) as Ask,
      (async () => {
        throw new Error('network')
      }) as Ask,
      gemini({ nonsense: true })
    ]) {
      const { stored, run } = await read({ live: true, ask })
      expect(run).toMatchObject({ state: 'ready', analysis: 'skipped' })
      expect(stored.findings.map((f) => f.topic)).toEqual([
        'price_band',
        'locale'
      ])
    }
  })

  it('fails the job when the catalog cannot be stored', async () => {
    const { db } = database()
    ;(db.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { code: 'PT409', message: 'Lease unavailable' }
    })
    await expect(
      readBrandCatalog(db, job, {
        client: klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
          transport: recordedCatalogTransport({ now: new Date(now) }),
          maxWaits: 0
        }),
        live: false,
        ask: sampleAsk,
        callMs: 10_000,
        now: () => now
      })
    ).rejects.toMatchObject({ code: 'PT409' })
  })
})
