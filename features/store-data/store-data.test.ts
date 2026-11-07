import { describe, expect, it } from 'vitest'
import { sampleShopifySnapshot } from '@/lib/providers/fake-shopify-read'
import type { ShopifySnapshot } from '@/lib/providers/shopify-read'
import { lowStockAt, stockReport, type CatalogueProduct } from './stock'
import { changeText, storeSummary } from './summary'

const now = new Date('2026-11-06T12:00:00Z')
const tenant = '00000000-0000-4000-8000-000000000101'

describe('sample Shopify store', () => {
  const snapshot = sampleShopifySnapshot({
    tenantId: tenant,
    timezone: 'Asia/Kathmandu',
    shopDomain: 'cedar.myshopify.com',
    now
  })

  it('has 30 days, oldest first, ending today in the brand timezone', () => {
    expect(snapshot.daily).toHaveLength(30)
    // 12:00 UTC is 17:45 in Kathmandu: still Nov 6 there.
    expect(snapshot.daily.at(-1)?.date).toBe('2026-11-06')
    expect(snapshot.daily[0]?.date).toBe('2026-10-08')
    const dates = snapshot.daily.map((d) => d.date)
    expect(dates).toEqual([...dates].sort())
  })

  it('is the same store on every reload, and another workspace gets another', () => {
    expect(
      sampleShopifySnapshot({
        tenantId: tenant,
        timezone: 'Asia/Kathmandu',
        shopDomain: 'cedar.myshopify.com',
        now
      })
    ).toEqual(snapshot)
    const other = sampleShopifySnapshot({
      tenantId: '00000000-0000-4000-8000-000000000102',
      timezone: 'Asia/Kathmandu',
      shopDomain: null,
      now
    })
    expect(other.daily).not.toEqual(snapshot.daily)
    expect(other.shop.domain).toBe('sample-store.myshopify.com')
  })

  it('uses one currency and no future orders', () => {
    const currencies = new Set([
      snapshot.shop.currency,
      ...snapshot.daily.map((d) => d.revenue.currency),
      snapshot.previous.revenue.currency,
      ...snapshot.topCustomers.map((c) => c.spent.currency)
    ])
    expect([...currencies]).toEqual(['USD'])
    for (const c of snapshot.topCustomers)
      expect(Date.parse(c.lastOrderAt)).toBeLessThanOrEqual(now.getTime())
    expect(snapshot.daily.every((d) => d.orders >= 0)).toBe(true)
  })

  it('lists five top customers, highest spend first, as fictional sample people', () => {
    expect(snapshot.topCustomers).toHaveLength(5)
    const spent = snapshot.topCustomers.map((c) => c.spent.minor)
    expect(spent).toEqual([...spent].sort((a, b) => b - a))
    const firsts = snapshot.topCustomers.map((c) => c.name.split(' ')[0])
    expect(new Set(firsts).size).toBe(5)
    for (const c of snapshot.topCustomers) {
      expect(c.name).toMatch(/^[A-Z][a-z]+ [A-Z]\.$/)
      expect(c.id).toMatch(/^sample-customer-/)
    }
    expect(snapshot.customers30d.returning).toBeLessThanOrEqual(
      snapshot.customers30d.total
    )
  })
})

describe('storeSummary', () => {
  const base: ShopifySnapshot = {
    shop: { name: 'Sample store', domain: 'x.myshopify.com', currency: 'USD' },
    daily: [
      {
        date: '2026-11-04',
        orders: 2,
        revenue: { minor: 10000, currency: 'USD' }
      },
      { date: '2026-11-05', orders: 0, revenue: { minor: 0, currency: 'USD' } },
      {
        date: '2026-11-06',
        orders: 3,
        revenue: { minor: 15000, currency: 'USD' }
      }
    ],
    previous: { revenue: { minor: 20000, currency: 'USD' }, orders: 5 },
    customers30d: { total: 4, returning: 1 },
    topCustomers: [],
    syncedAt: null
  }

  it('adds up the days, so the cards and the chart agree', () => {
    const s = storeSummary(base)
    expect(s.revenue).toEqual({ minor: 25000, currency: 'USD' })
    expect(s.orders).toBe(5)
    expect(s.averageOrder).toEqual({ minor: 5000, currency: 'USD' })
    expect(s.revenueChange).toBe(25)
    expect(s.ordersChange).toBe(0)
    expect(s.returningPercent).toBe(25)
    expect(s.bestDay?.date).toBe('2026-11-06')
  })

  it('never divides by zero', () => {
    const s = storeSummary({
      ...base,
      daily: base.daily.map((d) => ({
        ...d,
        orders: 0,
        revenue: { minor: 0, currency: 'USD' }
      })),
      previous: { revenue: { minor: 0, currency: 'USD' }, orders: 0 },
      customers30d: { total: 0, returning: 0 }
    })
    expect(s.averageOrder).toBeNull()
    expect(s.revenueChange).toBeNull()
    expect(s.ordersChange).toBeNull()
    expect(s.returningPercent).toBeNull()
    expect(s.bestDay).toBeNull()
  })

  it('leaves out amounts in another currency', () => {
    const s = storeSummary({
      ...base,
      daily: [
        ...base.daily,
        {
          date: '2026-11-03',
          orders: 1,
          revenue: { minor: 99999, currency: 'EUR' }
        }
      ],
      previous: { revenue: { minor: 100, currency: 'EUR' }, orders: 5 }
    })
    expect(s.revenue.minor).toBe(25000)
    expect(s.revenueChange).toBeNull()
  })

  it('says the change in plain words', () => {
    expect(changeText(12)).toBe('+12% vs the 30 days before')
    expect(changeText(-4)).toBe('−4% vs the 30 days before')
    expect(changeText(0)).toBe('About the same as the 30 days before')
    expect(changeText(null)).toBeNull()
  })
})

describe('stockReport', () => {
  const p = (
    id: string,
    stock: number,
    hoursAgo = 1,
    sample = true
  ): CatalogueProduct => ({
    id,
    title: `Product ${id}`,
    url: null,
    stock,
    stockObservedAt: new Date(
      now.getTime() - hoursAgo * 3600_000
    ).toISOString(),
    sample
  })

  it('sorts products into out of stock, low and not checked lately', () => {
    const report = stockReport(
      [p('a', 0), p('b', lowStockAt), p('c', 1), p('d', 20), p('e', 20, 30)],
      now
    )
    expect(report.total).toBe(5)
    expect(report.outOfStock.map((x) => x.id)).toEqual(['a'])
    // Fewest left first.
    expect(report.low.map((x) => x.id)).toEqual(['c', 'b'])
    expect(report.stale.map((x) => x.id)).toEqual(['e'])
    expect(report.sample).toBe(true)
  })

  it('counts a missing or broken check time as not checked', () => {
    const broken = { ...p('x', 10), stockObservedAt: 'not a date' }
    expect(stockReport([broken], now).stale).toHaveLength(1)
  })

  it('is only "sample" when every product is', () => {
    expect(stockReport([p('a', 3), p('b', 3, 1, false)], now).sample).toBe(
      false
    )
    expect(stockReport([], now)).toMatchObject({ total: 0, sample: false })
  })
})
