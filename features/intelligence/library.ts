import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { blockTypes, type BlockType } from '@/features/blocks/catalog'
import type { Database } from '@/lib/supabase/database.types'
import {
  angles,
  brandSizes,
  emailTypes,
  industries,
  layouts,
  offerTypes,
  purposes,
  seasons,
  styles,
  type Layout,
  type Purpose,
  type Style
} from './taxonomy'
import { variantSpecSchema, type VariantSpec } from './variants'

/** One label, or any of up to 20. */
function oneOrMany<T extends string>(values: readonly T[]) {
  const one = z.enum(values as [T, ...T[]])
  return z.union([one, z.array(one).min(1).max(20)])
}

/**
 * Library search by every label (CI-002): the variant's own (family,
 * layout, purpose, style, source) and the emails its sections came from
 * (industry, email type, offer type, season, angle, brand size). Values
 * outside the lists are refused before the database is asked.
 */
export const libraryFilterSchema = z
  .object({
    family: oneOrMany(blockTypes),
    layout: oneOrMany(layouts),
    purpose: oneOrMany(purposes),
    style: oneOrMany(styles),
    source: oneOrMany(['seed', 'competitor'] as const),
    industry: oneOrMany(industries),
    emailType: oneOrMany(emailTypes),
    offerType: oneOrMany(offerTypes),
    season: oneOrMany(seasons),
    angle: oneOrMany(angles),
    brandSize: oneOrMany(brandSizes)
  })
  .partial()
  .strict()
export type LibraryFilter = z.infer<typeof libraryFilterSchema>

/** A variant as a search returns it: its structure and its labels. */
export type LibraryVariant = {
  /**
   * Its stable name: `<family>/seed` for a seed block (e.g.
   * `hero_product/seed`), `<family>/<16 hex>` for one from a competitor.
   */
  id: string
  family: BlockType
  layout: Layout
  purpose: Purpose
  styles: Style[]
  spec: VariantSpec
  source: 'seed' | 'competitor'
  /** Sections seen with this structure. */
  evidenceCount: number
  /** With an email label: the sections from such emails. */
  matches: number
  /** How well it did in sent emails: none until results are learned (LRN-002). */
  score: number | null
}

export type LibrarySearch =
  | { ok: true; variants: LibraryVariant[] }
  | { ok: false; code: 'invalid_filter' | 'access_denied' | 'unavailable' }

const columns: Record<keyof LibraryFilter, string> = {
  family: 'family',
  layout: 'layout',
  purpose: 'purpose',
  style: 'style',
  source: 'source',
  industry: 'industry',
  emailType: 'email_type',
  offerType: 'offer_type',
  season: 'season',
  angle: 'angle',
  brandSize: 'brand_size'
}

/**
 * Searches the block library, most seen first (or, with an email label,
 * most seen in such emails). Any signed-in workspace member and the agents
 * may search; only structures come back, never a section, an email or the
 * brand they came from. A member searching by the emails' labels only sees
 * structures seen at 3 brands or more. A stored row that no longer reads as a variant is
 * skipped rather than handed on.
 */
export async function searchBlockVariants(
  db: SupabaseClient<Database>,
  filters: unknown = {},
  limit = 50
): Promise<LibrarySearch> {
  const parsed = libraryFilterSchema.safeParse(filters)
  if (!parsed.success || !Number.isInteger(limit) || limit < 1 || limit > 100)
    return { ok: false, code: 'invalid_filter' }
  const query = Object.fromEntries(
    Object.entries(parsed.data).map(([k, v]) => [
      columns[k as keyof LibraryFilter],
      v
    ])
  )
  const { data, error } = await db.rpc('search_block_variants', {
    filters: query,
    max_results: limit
  })
  if (error)
    return {
      ok: false,
      code:
        error.code === '42501'
          ? 'access_denied'
          : error.code === '23514'
            ? 'invalid_filter'
            : 'unavailable'
    }
  const variants: LibraryVariant[] = []
  for (const row of data ?? []) {
    const spec = variantSpecSchema.safeParse(row.spec)
    if (!spec.success) continue
    variants.push({
      id: row.key,
      family: row.family as BlockType,
      layout: row.layout as Layout,
      purpose: row.purpose as Purpose,
      styles: row.styles as Style[],
      spec: spec.data,
      source: row.source as 'seed' | 'competitor',
      evidenceCount: row.evidence,
      matches: row.matches,
      score: null
    })
  }
  return { ok: true, variants }
}
