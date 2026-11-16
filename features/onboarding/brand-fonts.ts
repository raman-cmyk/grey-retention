import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { DesignedSection } from '@/features/studio/section'
import {
  latinFile,
  type FontKind,
  type FontRole,
  type SiteFont
} from './site/fonts'
import { hostOf } from './suggested-competitors'

type Db = SupabaseClient<Database>

/** One web font as a designed section loads it (`designedSection.fonts`). */
export type SectionFont = NonNullable<DesignedSection['fonts']>[number]
export type BrandFont = {
  family: string
  roles: FontRole[]
  kind: FontKind
  /** One file per weight and style, for the design studio (DST-003). */
  faces: SectionFont[]
}

/**
 * A family's faces as the design studio loads them: each weight and
 * style's first Latin file, in the Site reader's order (the section format
 * takes one file per font, one weight and no `unicode-range` yet). A
 * variable font's file is given at 400 and 700 where its range has them
 * (one file, loaded once), else at its lowest weight. Pure.
 */
export function studioFaces(font: SiteFont): SectionFont[] {
  const seen = new Set<string>()
  return font.files.flatMap((f) => {
    if (!latinFile(f)) return []
    const top = f.maxWeight ?? f.weight
    const inRange = [400, 700].filter((w) => f.weight <= w && w <= top)
    return (inRange.length ? inRange : [f.weight]).flatMap((weight) => {
      const style = `${weight}:${f.italic}`
      if (seen.has(style)) return []
      seen.add(style)
      return [{ family: font.family, url: f.url, weight, italic: f.italic }]
    })
  })
}

/**
 * The brand's web fonts (FONT-SITE part b), heading fonts first, as the
 * Site reader kept them from its newest live read (`brand_fonts`), each
 * with its faces for the design studio. None from a website other than
 * the workspace's current one. Called with the member's own client (row
 * rules), or with the worker's after the caller checked the person may
 * see this workspace. A failed read throws.
 */
export async function brandFonts(
  db: Db,
  tenantId: string
): Promise<BrandFont[]> {
  const [profile, kept] = await Promise.all([
    db
      .from('brand_profiles')
      .select('domain')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('brand_fonts')
      .select('domain,fonts')
      .eq('tenant_id', tenantId)
      .maybeSingle()
  ])
  for (const r of [profile, kept]) if (r.error) throw r.error
  const current = hostOf(profile.data?.domain ?? '')
  const fonts = kept.data?.fonts
  if (!current || kept.data?.domain !== current || !Array.isArray(fonts))
    return []
  // The database keeps only the reader's own shape (`private.site_fonts_ok`).
  return (fonts as unknown as SiteFont[]).map((font) => ({
    family: font.family,
    roles: font.roles,
    kind: font.kind,
    faces: studioFaces(font)
  }))
}
