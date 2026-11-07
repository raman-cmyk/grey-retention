import { lastDays } from './fake-klaviyo-read'
import type {
  ShopifyReadProvider,
  ShopifySnapshot,
  StoreCustomer,
  StoreDay
} from './shopify-read'

/**
 * Deterministic SAMPLE Shopify orders and customers for the fake provider.
 * Every name is fictional. The numbers depend only on the workspace and the
 * day, so a page reload shows the same store, and the totals are derived
 * from the daily rows, so the KPI strip and the chart always agree.
 */

const DAY = 24 * 3600 * 1000

/** A small, stable hash (FNV-1a) so each workspace gets its own sample store. */
function hash(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A repeatable number in [0, 1) for this workspace and key. */
function unit(seed: string, key: string) {
  return hash(`${seed}:${key}`) / 0x100000000
}

const firstNames = [
  'Maya',
  'Jonah',
  'Priya',
  'Leo',
  'Amara',
  'Felix',
  'Noor',
  'Tomas',
  'Ines',
  'Kai',
  'Zara',
  'Oskar'
]
const initials = 'ABCDEFGHJKLMNPRSTW'

export function sampleShopifySnapshot({
  tenantId,
  timezone,
  shopDomain,
  now = new Date(),
  currency = 'USD'
}: {
  tenantId: string
  timezone: string
  shopDomain: string | null
  now?: Date
  currency?: string
}): ShopifySnapshot {
  const seed = tenantId
  // Average order value between 45 and 85 (in major units).
  const averageOrder = 4500 + Math.round(unit(seed, 'aov') * 4000)
  const baseOrders = 3 + Math.round(unit(seed, 'volume') * 5)
  const dayRow = (date: string): StoreDay => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
    // Busier at the weekend, with day-to-day noise.
    const rhythm = weekday === 0 || weekday === 6 ? 1.6 : 1
    const orders = Math.max(
      0,
      Math.round(baseOrders * rhythm * (0.4 + unit(seed, `orders:${date}`)))
    )
    const basket = averageOrder * (0.8 + 0.4 * unit(seed, `basket:${date}`))
    return {
      date,
      orders,
      revenue: { minor: Math.round(orders * basket), currency }
    }
  }
  const sixty = lastDays(now, timezone, 60).map(dayRow)
  const daily = sixty.slice(30)
  const before = sixty.slice(0, 30)
  const orders30 = daily.reduce((n, d) => n + d.orders, 0)
  const total = Math.max(1, Math.round(orders30 * 0.8))
  const returning = Math.round(total * (0.25 + 0.2 * unit(seed, 'returning')))
  const topCustomers: StoreCustomer[] = Array.from({ length: 5 }, (_, i) => {
    const orders = 9 - i - Math.round(unit(seed, `c-orders:${i}`) * 2)
    // Five different first names (5 and 12 share no factor).
    const name = `${firstNames[(hash(`${seed}:names`) + i * 5) % firstNames.length]} ${
      initials[hash(`${seed}:initial:${i}`) % initials.length]
    }.`
    const daysAgo = 1 + Math.round(unit(seed, `c-last:${i}`) * 20)
    return {
      id: `sample-customer-${i + 1}`,
      name,
      orders,
      spent: {
        minor: Math.round(orders * averageOrder * (1.1 - i * 0.05)),
        currency
      },
      lastOrderAt: new Date(now.getTime() - daysAgo * DAY).toISOString()
    }
  }).sort((a, b) => b.spent.minor - a.spent.minor)
  return {
    shop: {
      name: 'Sample store',
      domain: shopDomain ?? 'sample-store.myshopify.com',
      currency
    },
    daily,
    previous: {
      revenue: {
        minor: before.reduce((n, d) => n + d.revenue.minor, 0),
        currency
      },
      orders: before.reduce((n, d) => n + d.orders, 0)
    },
    customers30d: { total, returning },
    topCustomers,
    syncedAt: null
  }
}

export class FakeShopifyReadProvider implements ShopifyReadProvider {
  async snapshot(input: {
    tenantId: string
    timezone: string
    shopDomain: string | null
    now: Date
  }) {
    return sampleShopifySnapshot(input)
  }
}
