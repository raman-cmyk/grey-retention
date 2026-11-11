// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import type { CatalogItem, StoreEvent } from '@/lib/providers/klaviyo/catalog'
import { catalogRecordings } from '@/lib/providers/klaviyo/recorded-catalog'
import {
  baseTitle,
  moneyOf,
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
const fromItems = (items: CatalogItem[]) => fromCatalogItems(items, now)
const views = [...eventsOf(r.viewedProduct), ...eventsOf(r.viewedProductPage2)]
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
    variantsMissing: false,
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
    const [p] = fromItems([
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
      fromItems([item({ variants: [variant('S', 4), variant('M', null)] })])[0]!
        .stock
    ).toBeNull()
  })

  it('makes one product of items listed one per variant (the same title and page)', () => {
    const products = fromItems([
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
    expect(fromItems([item({ published: false })])[0]!.published).toBe(false)
    expect(
      fromItems([
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

describe('what the reviews found', () => {
  const at = (days: number) => new Date(now - days * day).toISOString()
  const viewOf = (
    days: number,
    props: Record<string, unknown>
  ): StoreEvent => ({
    at: at(days),
    props: { ProductID: 1, URL: 'https://cedar.example/p/1', ...props }
  })
  const orderOf = (
    days: number,
    lines: Record<string, unknown>[]
  ): StoreEvent => ({
    at: at(days),
    props: { $extra: { line_items: lines } }
  })

  it("reads a store's formatted money, as Shopify's Viewed Product sends it", () => {
    for (const [value, amount] of [
      ['$89.00', 89],
      ['1.299,00 €', 1299],
      ['Rs. 1,299', 1299],
      ['£1,299.50', 1299.5],
      ["CHF 1'299.00", 1299],
      ['<span class=money>$89.00</span>', 89],
      ['89,5 €', 89.5],
      ['89', 89],
      [89, 89],
      ['', null],
      ['free', null],
      [-1, null]
    ] as const)
      expect(moneyOf(value), String(value)).toBe(amount)
  })

  it("fills a viewed product's missing title or price from its order lines", () => {
    const [p] = fromEvents(
      [viewOf(2, { Price: 'n/a' })],
      [
        orderOf(5, [
          {
            product_id: 1,
            title: 'Field Overshirt',
            quantity: 1,
            price: '89.00'
          }
        ])
      ],
      now
    )
    expect(p).toMatchObject({ title: 'Field Overshirt', price: 89 })
  })

  it('calls nothing new from events that do not reach back far enough to know', () => {
    // Orders reach back 80 days, but the views only 3: a product only viewed
    // lately is not known to be new.
    const products = fromEvents(
      [
        viewOf(1, { Name: 'Fresh Socks', Price: '$9.00' }),
        viewOf(3, { Name: 'Fresh Socks', Price: '$9.00' })
      ],
      [
        orderOf(80, [
          { product_id: 2, title: 'Old Coat', quantity: 1, price: '120.00' }
        ]),
        orderOf(10, [
          { product_id: 3, title: 'New Bag', quantity: 1, price: '45.00' }
        ])
      ],
      now
    )
    const byId = new Map(products.map((p) => [p.externalId, p.launchedAt]))
    expect(byId.get('1')).toBeNull()
    expect(byId.get('2')).toBeNull()
    // First ordered 10 days ago, in orders reaching back 80: new.
    expect(byId.get('3')).not.toBeNull()
  })

  it("dates a catalog item's launch only for a catalog that has been in Klaviyo long enough", () => {
    const fresh = fromCatalogItems(
      [
        {
          id: 'a',
          externalId: 'a',
          title: 'A',
          url: 'https://cedar.example/a',
          image: null,
          price: 1,
          compareAt: null,
          published: true,
          created: at(5),
          variants: [],
          variantsMissing: false
        }
      ],
      now
    )
    expect(fresh[0]!.launchedAt).toBeNull()
  })

  it('takes a stock as unknown when some of its variants were not in the answer', () => {
    const [p] = fromCatalogItems(
      [
        {
          id: 'a',
          externalId: 'a',
          title: 'A',
          url: 'https://cedar.example/a',
          image: null,
          price: 1,
          compareAt: null,
          published: true,
          created: null,
          variants: [
            {
              id: 'v',
              title: 'A - S',
              sku: 'S',
              price: 1,
              stock: 3,
              image: null,
              published: true
            }
          ],
          variantsMissing: true
        }
      ],
      now
    )
    expect(p!.stock).toBeNull()
  })

  it('adds up the sales of items listed one per variant', () => {
    const item = (id: string, title: string) => ({
      id,
      externalId: id,
      title,
      url: 'https://cedar.example/products/tote',
      image: null,
      price: 45,
      compareAt: null,
      published: true,
      created: null,
      variants: [],
      variantsMissing: false
    })
    const merged = fromCatalogItems(
      [item('t-s', 'Tote - S'), item('t-m', 'Tote - M')],
      now
    )
    const sales = salesFrom(
      [
        {
          at: at(2),
          props: {
            Items: [{ ProductID: 't-s', ProductName: 'Tote - S', Quantity: 2 }]
          }
        },
        {
          at: at(3),
          props: {
            Items: [{ ProductID: 't-m', ProductName: 'Tote - M', Quantity: 3 }]
          }
        }
      ],
      now
    )
    expect(withSales(merged, sales)).toMatchObject([
      { externalId: 't-s', units90d: 5 }
    ])
  })

  it('never lets one odd record fail a read: it is left out, or its odd part dropped', () => {
    const base = withSales(
      fromEvents(views, orders, now),
      salesFrom(orders, now)
    )[0]!
    const { records, leftOut } = finishCatalog(
      [
        base,
        { ...base },
        { ...base, externalId: 'big', price: 99_999_999 },
        { ...base, externalId: 'space', url: 'https://cedar.example/a b' },
        {
          ...base,
          externalId: 'long',
          url: `https://cedar.example/${'a'.repeat(2000)}`
        },
        {
          ...base,
          externalId: 'img',
          image: `https://cedar.example/${'i'.repeat(2000)}.jpg`
        },
        {
          ...base,
          externalId: 'when',
          launchedAt: '2026-11-01T10:00:00+05:30'
        },
        { ...base, externalId: 'free', price: 0 },
        { ...base, externalId: 'emoji', title: '🧥'.repeat(250) },
        { ...base, externalId: 'one', title: '🧥' }
      ],
      { currency: 'USD', currencyCheck: 'matched', duplicates: [], now }
    )
    // The repeated id, the price that does not fit, the page with a space,
    // the page too long, the one-letter title.
    expect(leftOut).toBe(5)
    const byId = new Map(records.map((r) => [r.externalId, r]))
    expect(byId.get('img')!.imageUrl).toBeNull()
    expect(byId.get('when')!.launchedAt).toBe('2026-11-01T04:30:00.000Z')
    expect(byId.get('free')).toMatchObject({
      featurable: false,
      hiddenReason: 'not_picked'
    })
    expect(Array.from(byId.get('emoji')!.title)).toHaveLength(200)
  })

  it('never takes a "no image" placeholder for a photo', () => {
    const [p] = fromEvents(
      [
        viewOf(1, {
          Name: 'Coat',
          Price: '$9.00',
          ImageURL: 'https://cdn.shopify.com/s/images/admin/no-image-large.gif'
        })
      ],
      [],
      now
    )
    expect(p!.image).toBeNull()
  })

  it('gives a price band to the cent, also in a currency with three decimals', () => {
    const { records } = finishCatalog(
      [
        {
          ...withSales(
            fromEvents(views, orders, now),
            salesFrom(orders, now)
          )[0]!,
          price: 12.345
        }
      ],
      { currency: 'KWD', currencyCheck: 'matched', duplicates: [], now }
    )
    expect(records[0]!.priceMinor).toBe(12345)
    expect(priceBand(records)).toEqual({ min: 12.35, max: 12.35 })
  })

  it("reads the shop's own currency in a Shopify order", () => {
    expect(
      orderCurrency([
        {
          at: at(1),
          props: { $extra: { currency: 'EUR' }, $currency_code: 'USD' }
        }
      ])
    ).toMatchObject({ currency: 'EUR' })
  })
})
