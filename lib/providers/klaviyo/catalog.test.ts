// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  catalogItemsPath,
  eventsPath,
  findStoreMetrics,
  maxCatalogPages,
  metricsPath,
  readCatalogItems,
  readEvents,
  readOrderReturns,
  storeLocale
} from './catalog'
import {
  KlaviyoError,
  klaviyoClient,
  type KlaviyoResponse,
  type KlaviyoTransport
} from './client'
import { recorded } from './recorded'
import { catalogRecordings, recordedCatalogTransport } from './recorded-catalog'

const key = 'pk_SAMPLE0123456789abcdefghij'
const now = new Date('2026-11-11T12:00:00Z')
const always = () => true
const client = (transport: KlaviyoTransport) =>
  klaviyoClient(key, { transport, maxWaits: 0 })
const failure = async (call: Promise<unknown>) => {
  try {
    await call
  } catch (error) {
    return error as KlaviyoError
  }
  throw new Error('expected a failure')
}

describe('the catalog read, against recorded Klaviyo answers', () => {
  it('reads a catalog sent to Klaviyo directly, each item with its variants, and skips a record it does not know', async () => {
    const transport = recordedCatalogTransport({ store: 'custom', now })
    const read = await readCatalogItems(client(transport), always)
    expect(read).toMatchObject({ complete: true, skipped: 1 })
    expect(read.records.map((i) => [i.externalId, i.title])).toEqual([
      ['CG-OVERSHIRT', 'Field Overshirt'],
      ['CG-TOTE', 'Canvas Tote'],
      ['CG-SCARF', 'Old Scarf']
    ])
    expect(read.records[0]).toMatchObject({
      url: 'https://cedar.example/products/field-overshirt',
      image: 'https://cedar.example/cdn/shop/files/field-overshirt.jpg',
      price: 89,
      published: true
    })
    expect(read.records[0]!.variants.map((v) => [v.sku, v.stock])).toEqual([
      ['CG-OVERSHIRT-S', 4],
      ['CG-OVERSHIRT-M', 0],
      ['CG-OVERSHIRT-L', 7]
    ])
    expect(read.records[1]).toMatchObject({ compareAt: 60, variants: [] })
    expect(read.records[2]).toMatchObject({ published: false })
    // One request: the catalog with its variants, read-only.
    expect(transport.calls).toEqual([`GET ${catalogItemsPath}`])
  })

  it("shows nothing for a Shopify store's catalog (only directly sent catalogs are in the API)", async () => {
    const read = await readCatalogItems(
      client(recordedCatalogTransport({ store: 'shopify', now })),
      always
    )
    expect(read).toEqual({ records: [], complete: true, skipped: 0 })
  })

  it("finds the store's own Placed Order and Viewed Product metrics", async () => {
    const transport = recordedCatalogTransport({ now })
    expect(await findStoreMetrics(client(transport), always)).toEqual({
      placedOrder: 'PlcdOr',
      viewedProduct: 'VwdPrd',
      // No Cancelled or Refunded Order metric: the store has none of them.
      cancelledOrder: null,
      refundedOrder: null,
      // The recorded store has no Clicked Email metric (LRN-001's own does).
      clickedEmail: null,
      complete: true
    })
    expect(transport.calls).toEqual([`GET ${metricsPath}`])
  })

  it("finds the store's Cancelled and Refunded Order metrics, in either spelling", async () => {
    expect(
      await findStoreMetrics(
        client(recordedCatalogTransport({ now, returns: true })),
        always
      )
    ).toMatchObject({ cancelledOrder: 'CnclOr', refundedOrder: 'RfndOr' })
    const metric = (id: string, name: string) => ({
      type: 'metric',
      id,
      attributes: { name, integration: { name: 'API' } }
    })
    const transport: KlaviyoTransport = async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        data: [
          metric('PlcdOr', 'Placed Order'),
          metric('Cncl1', 'Canceled Order')
        ],
        links: { next: null }
      })
    })
    expect(await findStoreMetrics(client(transport), always)).toMatchObject({
      cancelledOrder: 'Cncl1',
      refundedOrder: null
    })
  })

  it('reads the cancels and refunds of the window in Shopify’s shape, and none without the metrics', async () => {
    const transport = recordedCatalogTransport({ now, returns: true })
    const since = new Date(now.getTime() - 90 * 86_400_000)
    const metrics = { cancelledOrder: 'CnclOr', refundedOrder: 'RfndOr' }
    const read = await readOrderReturns(
      client(transport),
      metrics,
      since,
      always
    )
    expect(read.cancels).toMatchObject({ complete: true, skipped: 0 })
    expect(read.cancels.records.map((e) => e.props.$event_id)).toEqual([
      '1001',
      '100120'
    ])
    expect(read.refunds.records[0]!.props).toMatchObject({
      $event_id: '10014',
      $value: 90,
      $extra: { line_items: [{ product_id: 7003, quantity: 2 }] }
    })
    expect(transport.calls).toEqual([
      `GET ${eventsPath('CnclOr', since)}`,
      `GET ${eventsPath('RfndOr', since)}`
    ])
    const none = recordedCatalogTransport({ now })
    expect(
      await readOrderReturns(
        client(none),
        { cancelledOrder: null, refundedOrder: null },
        since,
        always
      )
    ).toEqual({
      cancels: { records: [], complete: true, skipped: 0 },
      refunds: { records: [], complete: true, skipped: 0 }
    })
    expect(none.calls).toEqual([])
  })

  it('leaves a refused cancels read unread, but never waits out the pace', async () => {
    const since = new Date(now.getTime() - 90 * 86_400_000)
    const metrics = { cancelledOrder: 'CnclOr', refundedOrder: 'RfndOr' }
    const refused = recordedCatalogTransport({
      now,
      returns: true,
      fail: {
        on: 'returns',
        with: { status: 400, headers: {}, body: '{"errors":[{"status":400}]}' }
      }
    })
    const read = await readOrderReturns(client(refused), metrics, since, always)
    expect(read.cancels.complete).toBe(false)
    expect(read.refunds.complete).toBe(false)
    const throttled = recordedCatalogTransport({
      now,
      returns: true,
      fail: { on: 'returns', with: recorded.throttled(5) }
    })
    expect(
      (
        await failure(
          readOrderReturns(client(throttled), metrics, since, always)
        )
      ).kind
    ).toBe('rate_limited')
  })

  it('reads the events of the last 90 days, newest first, with their properties', async () => {
    const transport = recordedCatalogTransport({ now })
    const since = new Date(now.getTime() - 90 * 86_400_000)
    const views = await readEvents(client(transport), 'VwdPrd', since, always)
    expect(views.complete).toBe(true)
    expect(views.records).toHaveLength(11)
    expect(views.records[0]).toMatchObject({
      props: { Name: 'Trail Socks', ProductID: 7005, Price: '$18.50' }
    })
    const orders = await readEvents(client(transport), 'PlcdOr', since, always)
    expect(orders.records[0]!.props).toMatchObject({
      $currency_code: 'USD',
      $extra: { line_items: [{ product_id: 7001, quantity: 2 }] }
    })
    expect(transport.calls[0]).toBe(
      'GET /api/events?fields[event]=event_properties,datetime&filter=equals(metric_id,"VwdPrd"),greater-than(datetime,2026-08-13T12:00:00Z)&sort=-datetime'
    )
  })

  it('never builds an events address from a metric id that is not one', () => {
    expect(() => eventsPath('X"),equals(profile_id,"1', now)).toThrow(
      KlaviyoError
    )
  })

  it("reads the account's currency and language", () => {
    expect(storeLocale(JSON.parse(recorded.account.body))).toEqual({
      currency: 'USD',
      language: 'en'
    })
    expect(() => storeLocale({ data: [] })).toThrow(KlaviyoError)
  })
})

describe('paging', () => {
  const pages = (count: number) => {
    const answers: KlaviyoResponse[] = Array.from(
      { length: count },
      (_, i) => ({
        status: 200,
        headers: {},
        body: JSON.stringify({
          data: [],
          links: {
            next:
              i < count - 1
                ? `https://a.klaviyo.com/api/catalog-items/?page[cursor]=p${i + 2}`
                : null
          }
        })
      })
    )
    const calls: string[] = []
    const transport: KlaviyoTransport = async (request) => {
      calls.push(request.url)
      return answers.shift()!
    }
    return { transport, calls }
  }

  it('follows the next pages, and stops at the page cap as incomplete', async () => {
    const all = pages(3)
    expect(
      (await readCatalogItems(client(all.transport), always)).complete
    ).toBe(true)
    expect(all.calls).toHaveLength(3)
    const many = pages(maxCatalogPages + 2)
    expect(
      (await readCatalogItems(client(many.transport), always)).complete
    ).toBe(false)
    expect(many.calls).toHaveLength(maxCatalogPages)
  })

  it('asks for no next page once the time is up', async () => {
    const some = pages(5)
    let left = 1
    const read = await readCatalogItems(
      client(some.transport),
      () => left-- > 0
    )
    expect(read.complete).toBe(false)
    expect(some.calls).toHaveLength(2)
  })

  it('never follows a next link off Klaviyo', async () => {
    const transport: KlaviyoTransport = async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        data: [],
        links: { next: 'https://evil.example/api/catalog-items/?page=2' }
      })
    })
    expect(
      (await failure(readCatalogItems(client(transport), always))).kind
    ).toBe('invalid_response')
  })
})

describe('what Klaviyo refuses', () => {
  for (const [name, response, kind] of [
    ['a bad key', recorded.badKey, 'bad_key'],
    ['a missing scope', recorded.noScope, 'missing_scope'],
    [
      'a rate limit (even a short one: never waited out here)',
      recorded.throttled(5),
      'rate_limited'
    ],
    ['an outage', recorded.down, 'unavailable']
  ] as const)
    it(`names ${name}`, async () => {
      const transport = recordedCatalogTransport({
        store: 'custom',
        now,
        fail: { on: 'catalog', with: response }
      })
      const error = await failure(readCatalogItems(client(transport), always))
      expect(error.kind).toBe(kind)
      expect(error.message).not.toContain(key)
      if (kind === 'missing_scope')
        expect(error.details.scope).toBe('catalogs:read')
      if (kind === 'rate_limited')
        expect(error.details.retryAfterSeconds).toBe(5)
    })

  it('calls an answer of an unknown shape a change on their side', async () => {
    const transport: KlaviyoTransport = async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ items: [] })
    })
    expect(
      (await failure(readCatalogItems(client(transport), always))).kind
    ).toBe('invalid_response')
  })

  it('records only the made-up store', () => {
    const r = catalogRecordings({ now })
    const text = JSON.stringify(r)
    expect(text).not.toMatch(/@(?!example)[a-z0-9-]+\.[a-z]/i)
    expect(text).toContain('cedar.example')
  })
})
