import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { siteDomain } from './flow-model'

/**
 * What GROS found about the brand, for the Brand step (UI-ONBb): only what
 * is saved, never made up, and never another website's (ONB-SITEa). The
 * logo the Site reader kept from this same website (`brand_logos`), the
 * brand kit's colors and fonts (`brand_kits`) when the kit was saved since
 * this website was (the kit keeps no website, so an older one may be the
 * old website's), and the first products of the Klaviyo catalog, of the
 * kind it was last read (a real store never shows the sample's). Each is
 * empty when nothing was found yet.
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
/** The brand profile's newest saves looked at for when its website was saved. */
export const savesLooked = 50

/**
 * When the website was saved, as the brand profile's saves record it
 * (`brand_versions`, newest first): the oldest of the newest saves that
 * all hold this website, compared as the readers read it. Null when the
 * newest save does not hold it. Pure.
 */
export function websiteSavedAt(
  saves: readonly { created_at: string; domain: string | null }[],
  site: string
): string | null {
  let since: string | null = null
  for (const save of saves) {
    if (siteDomain(save.domain) !== site) break
    since = save.created_at
  }
  return since
}

/** The found brand for the saved website; throws when a read fails. */
export async function readBrandFound(
  db: SupabaseClient<Database>,
  tenantId: string,
  site: string
): Promise<BrandFound> {
  const [kit, saves, logos, status] = await Promise.all([
    db
      .from('brand_kits')
      .select('colors,fonts,updated_at')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('brand_versions')
      .select('created_at,domain:snapshot->>domain')
      .eq('tenant_id', tenantId)
      .order('revision', { ascending: false })
      .limit(savesLooked),
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
  if (saves.error) throw saves.error
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
  // A kit saved before this website was may be the old website's.
  const since = websiteSavedAt(saves.data ?? [], site)
  const ownKit =
    kit.data &&
    since !== null &&
    Date.parse(kit.data.updated_at) >= Date.parse(since)
      ? kit.data
      : null
  return {
    // Logos read from another website (the owner changed it) are not his.
    logo:
      logo && logo.domain === site && logo.on_light?.startsWith('https://')
        ? logo.on_light
        : null,
    colors: (ownKit?.colors ?? []).filter((c) => hex.test(c)),
    fonts: (ownKit?.fonts ?? []).filter((f) => fontName.test(f)),
    products,
    catalogRead: !!status.data
  }
}
