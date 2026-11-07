import type {
  Money,
  ShopifySnapshot,
  StoreDay
} from '@/lib/providers/shopify-read'

export type StoreSummary = {
  revenue: Money
  orders: number
  /** Revenue ÷ orders, or null without orders. */
  averageOrder: Money | null
  /** Revenue change in % against the 30 days before; null if those had none. */
  revenueChange: number | null
  ordersChange: number | null
  /** Share of last-30-day customers who had ordered before, in %. */
  returningPercent: number | null
  bestDay: StoreDay | null
}

const change = (now: number, before: number) =>
  before > 0 ? Math.round(((now - before) / before) * 100) : null

/** The 30-day numbers every Store card shows, derived from the daily rows. */
export function storeSummary(snapshot: ShopifySnapshot): StoreSummary {
  const currency = snapshot.shop.currency
  const days = snapshot.daily.filter((d) => d.revenue.currency === currency)
  const revenue = days.reduce((n, d) => n + d.revenue.minor, 0)
  const orders = days.reduce((n, d) => n + d.orders, 0)
  const best = days.reduce<StoreDay | null>(
    (top, d) =>
      d.revenue.minor > 0 && (!top || d.revenue.minor > top.revenue.minor)
        ? d
        : top,
    null
  )
  const { total, returning } = snapshot.customers30d
  return {
    revenue: { minor: revenue, currency },
    orders,
    averageOrder:
      orders > 0 ? { minor: Math.round(revenue / orders), currency } : null,
    revenueChange:
      snapshot.previous.revenue.currency === currency
        ? change(revenue, snapshot.previous.revenue.minor)
        : null,
    ordersChange: change(orders, snapshot.previous.orders),
    returningPercent:
      total > 0 ? Math.round((Math.min(returning, total) / total) * 100) : null,
    bestDay: best
  }
}

/** "+12% vs the 30 days before", "−4% …", "About the same as …", or null. */
export function changeText(percent: number | null) {
  if (percent === null) return null
  // A change under half a percent rounds to 0: "about", not "the same".
  if (percent === 0) return 'About the same as the 30 days before'
  return `${percent > 0 ? '+' : '−'}${Math.abs(percent)}% vs the 30 days before`
}
