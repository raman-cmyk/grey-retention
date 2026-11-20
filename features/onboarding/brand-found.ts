import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

/**
 * What GROS found about the brand, for the Brand step (UI-ONBb): only what
 * is saved, never made up. The logo the Site reader kept from this same
 * website (`brand_logos`), the brand kit's colors and fonts (`brand_kits`)
 * and the first products of the Klaviyo catalog, of the kind it was last
 * read (a real store never shows the sample's). Each is empty when nothing
 * was found yet.
 */
export type BrandFound = {
  /** The logo for light backgrounds; null when none was kept for this website. */
  logo: string | null
  /** Colors as `#rrggbb` (or `#rgb`); anything else is left out. */
  colors: string[]
  fonts: string[]
  /** Product titles, best sellers first, at most `maxProducts`. */
  products: string[]
  /** The Klaviyo catalog was read (so no products means it has none). */
  catalogRead: boolean
}

export const maxProducts = 4
const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const fontName = /^[\p{L}\p{N} '-]{1,60}$/u

/** The found brand for the saved website; throws when a read fails. */
export async function readBrandFound(
  db: SupabaseClient<Database>,
  tenantId: string,
  site: string
): Promise<BrandFound> {
  const [kit, logos, status] = await Promise.all([
    db
      .from('brand_kits')
      .select('colors,fonts')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('brand_logos')
      .select('domain,on_light')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('catalog_status')
      .select('live')
      .eq('tenant_id', tenantId)
      .maybeSingle()
  ])
  if (kit.error) throw kit.error
  if (logos.error) throw logos.error
  if (status.error) throw status.error
  let products: string[] = []
  if (status.data) {
    const read = await db
      .from('products')
      .select('title')
      .eq('tenant_id', tenantId)
      .eq('source', 'klaviyo')
      .eq('synthetic', !status.data.live)
      .is('retired_at', null)
      .order('bestseller_rank', { ascending: true, nullsFirst: false })
      .order('title')
      .limit(maxProducts)
    if (read.error) throw read.error
    products = (read.data ?? []).map((p) => p.title)
  }
  const logo = logos.data
  return {
    // Logos read from another website (the owner changed it) are not his.
    logo:
      logo && logo.domain === site && logo.on_light?.startsWith('https://')
        ? logo.on_light
        : null,
    colors: (kit.data?.colors ?? []).filter((c) => hex.test(c)),
    fonts: (kit.data?.fonts ?? []).filter((f) => fontName.test(f)),
    products,
    catalogRead: !!status.data
  }
}
