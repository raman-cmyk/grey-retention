// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import type { CatalogItem, StoreEvent } from '@/lib/providers/klaviyo/catalog'
import { catalogRecordings } from '@/lib/providers/klaviyo/recorded-catalog'
import {
  baseTitle,
  checkDuplicates,
  currencyCheck,
  finishCatalog,
  fromCatalogItems,
  fromEvents,
  minorUnits,
  orderCurrency,
  orderLines,
  priceBand,
  salesFrom,
  sampleDuplicates,
  titleLikeness,
  withSales,
  type Listed
} from './clean'

const now = Date.parse('2026-11-11T12:00:00Z')
const day = 86_400_000
const eventsOf = (response: { body: string }): StoreEvent[] =>
  (
    JSON.parse(response.body) as {
      data: {
        attributes: {
          datetime: string
          event_properties: Record<string, unknown>
        }
      }[]
    }
  ).data.map((e) => ({
    at: new Date(e.attributes.datetime).toISOString(),
    props: e.attributes.event_properties
  }))
const r = catalogRecordings({ now: new Date(now) })
const views = eventsOf(r.viewedProduct)
const orders = eventsOf(r.placedOrder)

describe('baseTitle', () => {
  it('strips a variant ending, and only that', () => {
    for (const [title, base] of [
      ['Weekend Knit - Navy / L', 'Weekend Knit'],
      ['Field Overshirt - S', 'Field Overshirt'],
      ['Field Overshirt – Large', 'Field Overshirt'],
      ['Field Overshirt (M)', 'Field Overshirt'],
      ['Tee | Black, XL', 'Tee'],
      ['Face Oil - 30ml', 'Face Oil'],
      ['Socks - Pack of 3', 'Socks'],
      ['  Canvas   Tote  ', 'Canvas Tote'],
      ['Gift Card - $50', 'Gift Card - $50'],
      ['T-Shirt', 'T-Shirt'],
      ['Navy Coat', 'Navy Coat'],
      ['Coat - The Long One', 'Coat - The Long One']
    ])
      expect(baseTitle(title), title).toBe(base)
  })
})

describe('the catalog API path', () => {
  const item = (over: Partial<CatalogItem>): CatalogItem => ({
    id: 'x',
    externalId: 'x',
    title: 'Field Overshirt',
    url: 'https://cedar.example/products/field-overshirt',
    image: 'https://cedar.example/a.jpg',
    price: 89,
    compareAt: null,
    published: true,
    created: '2026-05-01T00:00:00.000Z',
    variants: [],
    ...over
  })
  const variant = (sku: string, stock: number | null, price = 89) => ({
    id: sku,
    title: `Field Overshirt - ${sku}`,
    sku,
    price,
    stock,
    image: null,
    published: true
  })

  it("groups an item's variants: the lowest price, the stock added up only when each says it", () => {
    const [p] = fromCatalogItems([
      item({
        price: null,
        image: null,
        variants: [
          { ...variant('S', 4, 95), image: 'https://cedar.example/s.jpg' },
          variant('M', 0),
          variant('L', 7)
        ]
      })
    ])
    expect(p).toMatchObject({
      price: 89,
      stock: 11,
      variantCount: 3,
      image: 'https://cedar.example/s.jpg'
    })
    expect(
      fromCatalogItems([
        item({ variants: [variant('S', 4), variant('M', null)] })
      ])[0]!.stock
    ).toBeNull()
  })

  it('makes one product of items listed one per variant (the same title and page)', () => {
    const products = fromCatalogItems([
      item({
        externalId: 'a',
        title: 'Field Overshirt - S',
        price: 95,
        created: '2026-06-01T00:00:00.000Z'
      }),
      item({ externalId: 'b', title: 'Field Overshirt - M' }),
      item({
        externalId: 'c',
        title: 'Field Overshirt',
        url: 'https://cedar.example/products/other'
      })
    ])
    expect(products).toHaveLength(2)
    expect(products[0]).toMatchObject({
      externalId: 'a',
      title: 'Field Overshirt',
      price: 89,
      variantCount: 2,
      launchedAt: '2026-05-01T00:00:00.000Z'
    })
  })

  it('counts an unpublished item (or one whose variants are all unpublished) as unpublished', () => {
    expect(fromCatalogItems([item({ published: false })])[0]!.published).toBe(
      false
    )
    expect(
      fromCatalogItems([
        item({ variants: [{ ...variant('S', 1), published: false }] })
      ])[0]!.published
    ).toBe(false)
  })
})

describe('the events path (a Shopify store)', () => {
  const products = fromEvents(views, orders, now)
  const byId = new Map(products.map((p) => [p.externalId, p]))

  it('builds each product from its latest view, with its title without the variant', () => {
    expect(byId.get('7002')).toMatchObject({
      title: 'Weekend Knit',
      url: 'https://cedar.example/products/weekend-knit',
      image: 'https://cedar.example/cdn/shop/files/weekend-knit.jpg',
      price: 120,
      compareAt: 240,
      stock: null,
      published: true
    })
    expect(products.map((p) => p.externalId).sort()).toEqual([
      '7001',
      '7002',
      '7003',
      '7004',
      '7005',
      '7006'
    ])
  })

  it('takes a sale only when the full price was seen first; a compare-at always shown is not one', () => {
    expect(byId.get('7001')).toMatchObject({
      price: 69,
      compareAt: 89,
      saleSeen: true
    })
    expect(byId.get('7002')).toMatchObject({ saleSeen: false })
  })

  it('finds the new products (first seen in the last 30 days of a long enough window)', () => {
    expect(byId.get('7004')!.launchedAt).not.toBeNull()
    expect(byId.get('7005')!.launchedAt).not.toBeNull()
    expect(byId.get('7001')!.launchedAt).toBeNull()
    // A store with only a week of events: nothing can be called new.
    const recent = fromEvents(views.slice(0, 3), [], now)
    expect(recent.every((p) => p.launchedAt === null)).toBe(true)
  })

  it('adds a product seen only in orders, from its order line', () => {
    const custom = eventsOf(r.customOrders)
    const only = fromEvents([], custom, now)
    expect(only.find((p) => p.externalId === 'CG-OVERSHIRT')).toMatchObject({
      title: 'Field Overshirt',
      url: 'https://cedar.example/products/field-overshirt',
      price: 89
    })
    // No page for the tote in its order line: it cannot be stored.
    expect(only.find((p) => p.externalId === 'CG-TOTE')!.url).toBeNull()
  })

  it('reads Shopify line items and line items sent by an integration, skipping bad lines', () => {
    expect(
      orderLines({
        $extra: {
          line_items: [
            { product_id: 1, title: 'A', quantity: 2, price: '5.00' },
            { product_id: 2, quantity: 0 },
            { product_id: 'x y', quantity: 1 },
            'junk'
          ]
        }
      })
    ).toEqual([
      {
        id: '1',
        title: 'A',
        quantity: 2,
        price: 5,
        url: null,
        image: null,
        variant: null
      }
    ])
    expect(orderLines({ Items: ['Just a name'] })).toEqual([])
  })
})

describe('sales and currency', () => {
  it('counts the units of each product in the last 30 and 90 days', () => {
    const sales = salesFrom(orders, now)
    expect(sales.get('7001')).toMatchObject({ units30d: 3, units90d: 5 })
    expect(sales.get('7002')).toMatchObject({ units30d: 0, units90d: 2 })
    // An order older than 90 days, or from the future, is not counted.
    const old = salesFrom(
      [{ at: new Date(now - 91 * day).toISOString(), props: orders[0]!.props }],
      now
    )
    expect(old.size).toBe(0)
  })

  it("matches a custom catalog's sales by its own id, or by a title only one product has", () => {
    const listed = withSales(
      [
        { externalId: 'CG-OVERSHIRT', title: 'Field Overshirt' },
        { externalId: 'OTHER-ID', title: 'Canvas Tote' },
        { externalId: 'Z', title: 'Nothing Sold' }
      ].map((p) => ({
        ...p,
        url: 'https://cedar.example/p',
        image: null,
        price: 1,
        compareAt: null,
        saleSeen: false,
        published: true,
        launchedAt: null,
        stock: null,
        variantCount: 1
      })),
      salesFrom(eventsOf(r.customOrders), now)
    )
    expect(listed.map((p) => p.units90d)).toEqual([2, 1, 0])
  })

  it("checks the orders' currency against the account", () => {
    const usd = orderCurrency(orders)
    expect(usd).toEqual({ currency: 'USD', share: 1, said: 5 })
    expect(currencyCheck('USD', usd)).toBe('matched')
    expect(currencyCheck('EUR', usd)).toBe('mismatch')
    expect(currencyCheck('USD', orderCurrency([]))).toBe('unverified')
    const mixed = orderCurrency([
      { at: '', props: { $currency_code: 'GBP' } },
      { at: '', props: { $currency_code: 'GBP' } },
      { at: '', props: { currency: 'eur' } }
    ])
    expect(currencyCheck('EUR', mixed)).toBe('unverified')
  })
})

describe('duplicates', () => {
  const listed = (
    id: string,
    title: string,
    price: number,
    units = 0
  ): Listed => ({
    externalId: id,
    title,
    url: `https://cedar.example/${id}`,
    image: 'https://cedar.example/i.jpg',
    price,
    compareAt: null,
    saleSeen: false,
    published: true,
    launchedAt: null,
    stock: null,
    variantCount: 1,
    units30d: units,
    units90d: units
  })

  it('keeps only alike products at alike prices, keeps the one that sold more, and drops a product once', () => {
    const products = [
      listed('a', 'Canvas Tote', 45, 1),
      listed('b', 'Canvas Tote', 45, 3),
      listed('c', 'Field Overshirt', 89),
      listed('d', 'Canvas Tote Bag', 99),
      listed('e', 'Canvas Tote', 45)
    ]
    expect(
      checkDuplicates(products, [
        { keep: 'a', drop: 'b' },
        { keep: 'a', drop: 'c' },
        { keep: 'a', drop: 'd' },
        { keep: 'a', drop: 'a' },
        { keep: 'a', drop: 'missing' },
        { keep: 'e', drop: 'b' },
        { keep: 'b', drop: 'e' }
      ])
    ).toEqual([
      { keep: 'b', drop: 'a' },
      { keep: 'b', drop: 'e' }
    ])
    expect(titleLikeness('Canvas Tote', 'canvas tote')).toBe(1)
  })

  it('by the sample rules, are the same title at the same price', () => {
    expect(
      sampleDuplicates([
        listed('a', 'Tote', 45),
        listed('b', 'Tote', 45),
        listed('c', 'Tote', 50)
      ])
    ).toEqual([{ keep: 'a', drop: 'b' }])
  })
})

describe('finishCatalog', () => {
  const listed = withSales(
    fromEvents(views, orders, now),
    salesFrom(orders, now)
  )
  const finish = (over: Partial<Parameters<typeof finishCatalog>[1]> = {}) =>
    finishCatalog(listed, {
      currency: 'USD',
      currencyCheck: 'matched',
      duplicates: [{ keep: '7003', drop: '7006' }],
      now,
      ...over
    })

  it('stores prices in cents, hides a permanent compare-at, and features a small store whole', () => {
    const { records, leftOut, truncated } = finish()
    expect({ leftOut, truncated }).toEqual({ leftOut: 0, truncated: false })
    const byId = new Map(records.map((p) => [p.externalId, p]))
    expect(byId.get('7001')).toMatchObject({
      priceMinor: 6900,
      compareAtMinor: 8900,
      compareAtIsSale: true,
      featurable: true,
      bestsellerRank: 1,
      units30d: 3,
      units90d: 5
    })
    expect(byId.get('7002')).toMatchObject({
      compareAtMinor: 24000,
      compareAtIsSale: false
    })
    expect(byId.get('7005')).toMatchObject({
      priceMinor: 1850,
      newArrival: true
    })
    expect(byId.get('7004')).toMatchObject({
      featurable: false,
      hiddenReason: 'no_image',
      newArrival: true
    })
    // The old listing is hidden, and its sale counts for the tote kept.
    expect(byId.get('7006')).toMatchObject({
      featurable: false,
      hiddenReason: 'duplicate'
    })
    expect(byId.get('7003')).toMatchObject({ units90d: 3 })
  })

  it('features nothing when the orders are in another currency', () => {
    const { records } = finish({ currencyCheck: 'mismatch' })
    expect(records.every((p) => !p.featurable && p.hiddenReason)).toBe(true)
    expect(records.filter((p) => p.hiddenReason === 'currency')).toHaveLength(5)
  })

  it('in a bigger store features the top 20 bestsellers and the new arrivals, and lets the owner pick the rest', () => {
    const many: Listed[] = Array.from({ length: 30 }, (_, i) => ({
      ...listed[0]!,
      externalId: `p${i}`,
      title: `Product ${i}`,
      launchedAt: i === 29 ? new Date(now - 3 * day).toISOString() : null,
      units30d: i < 22 ? 30 - i : 0,
      units90d: i < 22 ? 30 - i : 0
    }))
    const { records } = finishCatalog(many, {
      currency: 'USD',
      currencyCheck: 'unverified',
      duplicates: [],
      now
    })
    const featured = records
      .filter((p) => p.featurable)
      .map((p) => p.externalId)
    expect(featured).toHaveLength(21)
    expect(featured).toContain('p29')
    expect(featured).not.toContain('p20')
    expect(records.find((p) => p.externalId === 'p20')).toMatchObject({
      bestsellerRank: 21,
      hiddenReason: 'not_picked'
    })
  })

  it('leaves out a product with no page or no price, and keeps at most 500', () => {
    const { leftOut } = finishCatalog(
      [
        { ...listed[0]!, url: null },
        { ...listed[0]!, externalId: 'x', price: null }
      ],
      { currency: 'USD', currencyCheck: 'matched', duplicates: [], now }
    )
    expect(leftOut).toBe(2)
    const lots = Array.from({ length: 501 }, (_, i) => ({
      ...listed[0]!,
      externalId: `p${i}`
    }))
    const big = finishCatalog(lots, {
      currency: 'USD',
      currencyCheck: 'matched',
      duplicates: [],
      now
    })
    expect(big.records).toHaveLength(500)
    expect(big.truncated).toBe(true)
  })

  it('gives the usual price range, without the duplicates, in the currency of the store', () => {
    expect(priceBand(finish().records)).toEqual({ min: 18.5, max: 120 })
    expect(priceBand([])).toBeNull()
    expect(minorUnits('JPY')).toBe(1)
    expect(minorUnits('USD')).toBe(100)
    expect(minorUnits('KWD')).toBe(1000)
  })
})
