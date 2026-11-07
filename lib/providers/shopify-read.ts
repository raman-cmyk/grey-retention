/**
 * Shopify READ port: a read-only snapshot of one workspace's store for the
 * Store tab (docs/UI_REBUILD_SPEC.md §5, "a store dashboard with revenue
 * trends, top customers and out-of-stock alerts"). The fake
 * (`fake-shopify-read.ts`) returns labelled sample orders and customers. A
 * live adapter must read a tenant-scoped snapshot written by the sync job,
 * never call Shopify during a page request.
 *
 * Products and stock are NOT part of this snapshot: they come from the
 * workspace's own catalogue (the `products` table), the same rows every
 * product picker and the scheduling stock check use.
 *
 * Money is in minor units of the ONE shop currency.
 */
import type { Money } from './klaviyo-read'

export type { Money }

export type StoreDay = {
  /** `YYYY-MM-DD` in the brand timezone. */
  date: string
  revenue: Money
  orders: number
}

export type StoreCustomer = {
  id: string
  /** Fictional in sample data, e.g. "Maya R.". */
  name: string
  /** Orders in the last 12 months. */
  orders: number
  /** Total spent in the last 12 months. */
  spent: Money
  lastOrderAt: string
}

export type ShopifySnapshot = {
  shop: { name: string; domain: string; currency: string }
  /** The last 30 days, oldest first, in the brand timezone. */
  daily: StoreDay[]
  /** The 30 days before those, for "compared with the 30 days before". */
  previous: { revenue: Money; orders: number }
  /** Customers who ordered in the last 30 days. */
  customers30d: { total: number; returning: number }
  /** Best customers of the last 12 months, highest spend first. */
  topCustomers: StoreCustomer[]
  /** When the snapshot was last synced from Shopify; null for sample data. */
  syncedAt: string | null
}

export interface ShopifyReadProvider {
  snapshot(input: {
    tenantId: string
    /** The one brand timezone every date is counted in. */
    timezone: string
    /** The shop's `*.myshopify.com` domain, when known. */
    shopDomain: string | null
    now: Date
  }): Promise<ShopifySnapshot>
}
