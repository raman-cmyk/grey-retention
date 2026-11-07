import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { brandMismatches, type AccountFacts } from './mismatch'
import type { SectionContent, SectionKey } from './sections'
import type { SectionRow } from './view'

/**
 * Everything the Brand profile reads besides the catalogue: saved sections,
 * connections (for the Store tab and the mismatch guard). Missing tables or
 * columns on an older hosted database degrade to empty values.
 */
export async function brandProfileData(
  tenantId: string,
  brand: { brand_name: string; domain: string } | null
) {
  const db = await createClient()
  if (!db) return null
  const [sections, connections, products] = await Promise.all([
    db.from('brand_profile_sections').select('*').eq('tenant_id', tenantId),
    db
      .from('workspace_connections')
      .select(
        'provider,status,account_label,shop_domain,account_website,account_currency,account_country'
      )
      .eq('tenant_id', tenantId),
    db
      .from('products')
      .select('url')
      .eq('tenant_id', tenantId)
      .limit(productLimit)
  ])
  const rows: SectionRow[] = (sections.data ?? []).map((row) => ({
    section: row.section as SectionKey,
    content: (row.content ?? {}) as SectionContent,
    locked: row.locked ?? [],
    revision: row.revision,
    updatedAt: row.updated_at
  }))
  const list = connections.data ?? []
  type Connection = (typeof list)[number]
  const klaviyo = list.find((c) => c.provider === 'klaviyo')
  const shopify = list.find((c) => c.provider === 'shopify')
  const connected = (c: Connection | undefined) => c?.status === 'connected'
  const facts = (c: Connection | undefined): AccountFacts | null =>
    connected(c)
      ? {
          website: c?.account_website ?? null,
          currency: c?.account_currency ?? null,
          country: c?.account_country ?? null
        }
      : null
  return {
    sections: rows,
    unavailable: Boolean(sections.error),
    shopifyConnected: connected(shopify),
    mismatches: brandMismatches({
      brandName: brand?.brand_name ?? '',
      website: brand?.domain ?? '',
      klaviyoAccount: connected(klaviyo)
        ? (klaviyo?.account_label ?? null)
        : null,
      shopDomain: connected(shopify) ? (shopify?.shop_domain ?? null) : null,
      klaviyo: facts(klaviyo),
      shopify: facts(shopify),
      productUrls: (products.data ?? []).map((p) => p.url)
    })
  }
}

/** Enough product links to see where the catalogue points. */
export const productLimit = 200

/**
 * The brand-mismatch guard for one workspace (UIR-021), for any screen that
 * is about to let the AI write: the Brand profile compared with the
 * connected accounts and the catalogue. Empty when nothing looks wrong or
 * nothing can be read.
 */
export async function brandGuard(tenantId: string) {
  const db = await createClient()
  if (!db) return []
  const brand = await db
    .from('brand_profiles')
    .select('brand_name,domain')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const data = await brandProfileData(tenantId, brand.data ?? null)
  return data?.mismatches ?? []
}
