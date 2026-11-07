import 'server-only'
import { cache } from 'react'
import { getServerEnvironment } from '@/lib/env/server'
import { FakeShopifyReadProvider } from '@/lib/providers/fake-shopify-read'
import type { ShopifySnapshot } from '@/lib/providers/shopify-read'
import { createClient } from '@/lib/supabase/server'
import { stockReport, type CatalogueProduct, type StockReport } from './stock'

/** What the Store tab may show, always stated honestly. */
export type StoreData =
  | {
      /** Sample orders and customers (fake adapters). */
      state: 'sample'
      snapshot: ShopifySnapshot
      stock: StockReport | null
    }
  | {
      /** Real mode: the live Shopify read is not built yet. */
      state: 'unavailable'
      stock: StockReport | null
    }
  | { state: 'not_connected' }
  /** The connection could not be read; nothing is claimed either way. */
  | { state: 'load_failed' }

/** Enough for every alert; the Brand page lists the whole catalogue. */
const productLimit = 500

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>

async function catalogue(
  db: Db,
  tenantId: string
): Promise<CatalogueProduct[] | null> {
  const { data, error } = await db
    .from('products')
    .select('id,title,url,stock,stock_observed_at,synthetic')
    .eq('tenant_id', tenantId)
    .order('title')
    .limit(productLimit)
  if (error) return null
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    stock: row.stock,
    stockObservedAt: row.stock_observed_at,
    sample: row.synthetic
  }))
}

/**
 * One workspace's store data for the Store tab, only while its Shopify
 * connection is on.
 * - Fake adapters (`ADAPTER_MODE=fake`, the default): labelled SAMPLE
 *   orders and customers.
 * - Real mode: "unavailable" for orders and customers, because the live
 *   read adapter is not built yet.
 * Stock alerts always come from the workspace's own catalogue.
 * `nowMs` is passed as milliseconds so request-level caching works.
 */
export const storeData = cache(
  async (
    tenantId: string,
    timezone: string,
    nowMs: number
  ): Promise<StoreData> => {
    const db = await createClient()
    if (!db) return { state: 'load_failed' }
    const connection = await db
      .from('workspace_connections')
      .select('status,shop_domain')
      .eq('tenant_id', tenantId)
      .eq('provider', 'shopify')
      .maybeSingle()
    if (connection.error) return { state: 'load_failed' }
    if (connection.data?.status !== 'connected')
      return { state: 'not_connected' }
    const shopDomain = connection.data.shop_domain
    const products = await catalogue(db, tenantId)
    const stock = products ? stockReport(products, new Date(nowMs)) : null
    if (getServerEnvironment().ADAPTER_MODE === 'real')
      return { state: 'unavailable', stock }
    const snapshot = await new FakeShopifyReadProvider().snapshot({
      tenantId,
      timezone,
      shopDomain,
      now: new Date(nowMs)
    })
    return { state: 'sample', snapshot, stock }
  }
)

/** The Store tab's data and the moment it was read (one "now" per page). */
export async function storeView(context: {
  tenantId: string
  timezone: string
}) {
  const now = Date.now()
  return { now, data: await storeData(context.tenantId, context.timezone, now) }
}
