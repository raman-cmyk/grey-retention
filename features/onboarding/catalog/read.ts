import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { CatalogProduct } from '@/features/assembly/inputs'
import { minorUnits } from './clean'

/**
 * The cleaned Klaviyo catalog as the other agents read it (ONB-102): the
 * Brand pulse (bestsellers, new arrivals, stock), the Content locker and
 * the assembly (real products, prices, photos and links only). RLS lets
 * any active member read it.
 */
export type CatalogEntry = {
  /** The product's id in this app (campaigns point at it). */
  id: string
  /** Klaviyo's id of it. */
  externalId: string
  title: string
  url: string
  /** In the store currency, e.g. "$89.00". */
  price: string
  /** In major units, e.g. 89. */
  amount: number
  currency: string
  /** Shown only when it is a temporary sale, e.g. "$120.00". */
  compareAt: string | null
  image: string | null
  featurable: boolean
  /** Why it is not featurable (no photo, a duplicate…), or null. */
  hiddenReason: string | null
  unitsSold30d: number
  unitsSold90d: number
  /** 1 for the best seller; null when it did not sell in 90 days. */
  bestsellerRank: number | null
  /** When it was added to the store, if known (ISO time). */
  launchedAt: string | null
  newArrival: boolean
  /** Units in stock; null when the store does not say. */
  stock: number | null
}

const money = (minor: number, currency: string) => {
  const amount = minor / minorUnits(currency)
  return {
    amount,
    text: new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(amount)
  }
}

/**
 * The workspace's current Klaviyo products (retired ones left out), best
 * sellers first. With `featurableOnly`, only those emails may feature.
 */
export async function listCatalog(
  db: SupabaseClient<Database>,
  tenantId: string,
  options: { featurableOnly?: boolean } = {}
): Promise<CatalogEntry[]> {
  let query = db
    .from('products')
    .select(
      'id,external_id,title,url,price_minor,currency,compare_at_minor,compare_at_is_sale,image_url,featurable,hidden_reason,units_30d,units_90d,bestseller_rank,launched_at,new_arrival,stock,stock_known'
    )
    .eq('tenant_id', tenantId)
    .eq('source', 'klaviyo')
    .is('retired_at', null)
    .order('bestseller_rank', { ascending: true, nullsFirst: false })
    .order('title')
    .limit(500)
  if (options.featurableOnly) query = query.eq('featurable', true)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((p) => {
    const price = money(p.price_minor, p.currency)
    return {
      id: p.id,
      externalId: p.external_id ?? '',
      title: p.title,
      url: p.url,
      price: price.text,
      amount: price.amount,
      currency: p.currency,
      compareAt:
        p.compare_at_is_sale && p.compare_at_minor !== null
          ? money(p.compare_at_minor, p.currency).text
          : null,
      image: p.image_url,
      featurable: p.featurable,
      hiddenReason: p.hidden_reason,
      unitsSold30d: p.units_30d ?? 0,
      unitsSold90d: p.units_90d ?? 0,
      bestsellerRank: p.bestseller_rank,
      launchedAt: p.launched_at,
      newArrival: p.new_arrival,
      stock: p.stock_known ? p.stock : null
    }
  })
}

/**
 * The catalog as the assembly takes it (`CatalogProduct`): only products
 * with a photo, and a compare-at price only when it is a temporary sale.
 */
export function assemblyProducts(entries: CatalogEntry[]): CatalogProduct[] {
  return entries.flatMap((e) =>
    e.image
      ? [
          {
            id: e.id,
            title: e.title,
            price: e.price,
            ...(e.compareAt
              ? { compareAt: e.compareAt, compareAtIsSale: true }
              : {}),
            image: e.image,
            url: e.url,
            featurable: e.featurable
          }
        ]
      : []
  )
}
