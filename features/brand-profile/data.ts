import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { brandMismatches, type AccountFacts } from './mismatch'
import type { SectionContent, SectionKey } from './sections'
import type { SectionRow } from './view'

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>
type Brand = { brand_name: string; domain: string } | null
type ConnectionRow = {
  provider: string
  status: string
  account_label: string | null
  shop_domain: string | null
  account_website?: string | null
  account_currency?: string | null
  account_country?: string | null
}

/** Enough product links to see where the catalogue points. */
export const productLimit = 200

/**
 * The workspace's connections with the account facts. On an older hosted
 * database without the facts (UIR-021), the name and store checks still run
 * on the columns it has, so no warning is lost and Shopify still counts as
 * connected.
 */
async function connectionRows(db: Db, tenantId: string) {
  const full = await db
    .from('workspace_connections')
    .select(
      'provider,status,account_label,shop_domain,account_website,account_currency,account_country'
    )
    .eq('tenant_id', tenantId)
  if (!full.error) return full.data as ConnectionRow[]
  const older = await db
    .from('workspace_connections')
    .select('provider,status,account_label,shop_domain')
    .eq('tenant_id', tenantId)
  return (older.data ?? []) as ConnectionRow[]
}

/**
 * The guard's verdict, from the rows already read. v2 is Klaviyo only
 * (BUILD_BRIEF D2): an old Shopify connection is ignored, so no owner sees
 * a Shopify check they can no longer act on.
 */
function guard(brand: Brand, list: ConnectionRow[], productUrls: string[]) {
  const klaviyo = list.find((c) => c.provider === 'klaviyo')
  const connected = (c: ConnectionRow | undefined) => c?.status === 'connected'
  const facts = (c: ConnectionRow | undefined): AccountFacts | null =>
    connected(c)
      ? {
          website: c?.account_website ?? null,
          currency: c?.account_currency ?? null,
          country: c?.account_country ?? null
        }
      : null
  return {
    mismatches: brandMismatches({
      brandName: brand?.brand_name ?? '',
      website: brand?.domain ?? '',
      klaviyoAccount: connected(klaviyo)
        ? (klaviyo?.account_label ?? null)
        : null,
      shopDomain: null,
      klaviyo: facts(klaviyo),
      shopify: null,
      productUrls
    })
  }
}

const productUrls = async (db: Db, tenantId: string) => {
  const { data } = await db
    .from('products')
    .select('url')
    .eq('tenant_id', tenantId)
    .limit(productLimit)
  return (data ?? []).map((p) => p.url)
}

/**
 * Everything the Brand profile reads besides the catalogue: saved sections,
 * connections (for the Store tab and the mismatch guard). Missing tables or
 * columns on an older hosted database degrade to empty values.
 */
export async function brandProfileData(tenantId: string, brand: Brand) {
  const db = await createClient()
  if (!db) return null
  const [sections, connections, urls] = await Promise.all([
    db.from('brand_profile_sections').select('*').eq('tenant_id', tenantId),
    connectionRows(db, tenantId),
    productUrls(db, tenantId)
  ])
  const rows: SectionRow[] = (sections.data ?? []).map((row) => ({
    section: row.section as SectionKey,
    content: (row.content ?? {}) as SectionContent,
    locked: row.locked ?? [],
    revision: row.revision,
    updatedAt: row.updated_at
  }))
  return {
    sections: rows,
    unavailable: Boolean(sections.error),
    ...guard(brand, connections, urls)
  }
}

/**
 * The brand-mismatch guard for one workspace (UIR-021), for any screen that
 * is about to let the AI write: the Brand profile compared with the
 * connected accounts and the catalogue. Empty when nothing looks wrong or
 * nothing can be read.
 */
export async function brandGuard(tenantId: string) {
  const db = await createClient()
  if (!db) return []
  const [brand, connections, urls] = await Promise.all([
    db
      .from('brand_profiles')
      .select('brand_name,domain')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    connectionRows(db, tenantId),
    productUrls(db, tenantId)
  ])
  return guard(brand.data ?? null, connections, urls).mismatches
}
