import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { brandMismatches } from './mismatch'
import type { SectionContent, SectionKey } from './sections'

export type SectionRow = {
  section: SectionKey
  content: SectionContent
  locked: string[]
  source: 'sample' | 'owner'
  revision: number
  updatedAt: string
}
// The display columns come from migration 20260914090017 (UIR-013) and may
// be missing on an older hosted database.
type Connection = {
  provider?: string
  status?: string
  account_label?: string | null
  shop_domain?: string | null
}

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
    db.from('workspace_connections').select('*').eq('tenant_id', tenantId)
  ])
  const rows: SectionRow[] = (sections.data ?? []).map((row) => ({
    section: row.section as SectionKey,
    content: (row.content ?? {}) as SectionContent,
    locked: row.locked ?? [],
    source: row.source as 'sample' | 'owner',
    revision: row.revision,
    updatedAt: row.updated_at
  }))
  const list = (connections.data ?? []) as Connection[]
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
