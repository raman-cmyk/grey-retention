import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { brandMismatches } from './mismatch'
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
  const [sections, connections] = await Promise.all([
    db.from('brand_profile_sections').select('*').eq('tenant_id', tenantId),
    db
      .from('workspace_connections')
      .select('provider,status,account_label,shop_domain')
      .eq('tenant_id', tenantId)
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
      shopDomain: connected(shopify) ? (shopify?.shop_domain ?? null) : null
    })
  }
}
