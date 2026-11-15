import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { listCatalog, type CatalogEntry } from './catalog/read'
import type { SitePageKind } from './findings'
import { hostOf } from './suggested-competitors'
import { emailPhotoUrl, photoKey, type PhotoKind } from './site/photos'

/**
 * The photo library (owner pick #59, ONB-059b): every product and
 * lifestyle photo of the brand, tagged for reuse. The catalog's own
 * product pictures first (each with its product), then the photos the
 * Site reader kept from the brand's pages (`brand_photos`, a live read
 * only). Only photos an email can show (`emailPhotoUrl`); the same photo
 * from both is listed once, as the catalog's, with the page's description
 * when the catalog has none. While the catalog was read from the fake
 * Klaviyo, only its sample products count, never mixed with a real
 * store's; a workspace whose catalog was never read has only its site's.
 * Site photos count only while they come from the workspace's current
 * website (the owner may have changed it since).
 */

export type LibraryPhoto = {
  url: string
  kind: PhotoKind
  /** Where it came from: the store's catalog or its own pages. */
  source: 'catalog' | 'site'
  /** Its description (untrusted text): the page's, or the product's title. */
  alt: string | null
  /** The page it was found on (site photos). */
  page: SitePageKind | null
  /** The product it shows (catalog photos). */
  productId: string | null
}

type Db = SupabaseClient<Database>

/** The library, best first. Pure, for tests. */
export function photoLibrary(
  catalog: readonly Pick<CatalogEntry, 'id' | 'title' | 'image'>[],
  site: readonly {
    url: string
    kind: string
    page: string
    alt: string | null
  }[]
): LibraryPhoto[] {
  const out = new Map<string, LibraryPhoto>()
  for (const p of catalog) {
    if (!p.image || !emailPhotoUrl(p.image)) continue
    const key = photoKey(p.image)
    if (out.has(key)) continue
    out.set(key, {
      url: p.image,
      kind: 'product',
      source: 'catalog',
      alt: p.title.trim() || null,
      page: null,
      productId: p.id
    })
  }
  for (const p of site) {
    if (!emailPhotoUrl(p.url)) continue
    const key = photoKey(p.url)
    const was = out.get(key)
    if (was) {
      // The catalog's own copy, with the page's words when it has none.
      if (!was.alt && p.alt) out.set(key, { ...was, alt: p.alt })
      continue
    }
    out.set(key, {
      url: p.url,
      kind: p.kind === 'product' ? 'product' : 'lifestyle',
      source: 'site',
      alt: p.alt,
      page: p.page as SitePageKind,
      productId: null
    })
  }
  return [...out.values()]
}

/** The workspace's photo library. A failed read throws. */
export async function readPhotoLibrary(
  db: Db,
  tenantId: string
): Promise<LibraryPhoto[]> {
  const [status, profile, set, site] = await Promise.all([
    db
      .from('catalog_status')
      .select('live')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('brand_profiles')
      .select('domain')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('brand_photo_sets')
      .select('domain')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('brand_photos')
      .select('url,kind,page,alt')
      .eq('tenant_id', tenantId)
      .order('position', { ascending: true })
      .limit(200)
  ])
  for (const r of [status, profile, set, site]) if (r.error) throw r.error
  const catalog = status.data
    ? await listCatalog(db, tenantId, { synthetic: !status.data.live })
    : []
  const current = hostOf(profile.data?.domain ?? '')
  const sameSite = !!current && set.data?.domain === current
  return photoLibrary(catalog, sameSite ? (site.data ?? []) : [])
}
