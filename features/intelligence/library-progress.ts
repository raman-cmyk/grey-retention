import type { SupabaseClient } from '@supabase/supabase-js'
import {
  blockTypes,
  isBlockType,
  type BlockType
} from '@/features/blocks/catalog'
import type { Database } from '@/lib/supabase/database.types'

/**
 * BLK-SCALE-001 (PROJECT_TODOS): counting the block library toward its
 * 2,000+ target. The taxonomy, in one place:
 *
 * - A **type** (family) is one of the 20 block types (`blockTypes`).
 * - A **variant** is one structure within a type: a `block_variants` row
 *   (CI-002), structure only, never a competitor's words, pictures, links
 *   or colours. Its fingerprint is the duplicate check: the same structure
 *   seen again adds evidence instead of a copy.
 * - A **template** is an email's order of types (CMP-047 `layoutOf`);
 *   winners are the templates brands keep sending.
 *
 * Provenance stays where CI-002 keeps it: `source` (seed or competitor),
 * the pass that made it, and the sections it came from (platform admins
 * only). Quality (a proposal until the owner confirms it): a variant counts
 * as a **useful block** when it is a seed or its structure was seen in
 * emails from at least `usefulBrands` different brands. CI-002's evidence
 * counts sections, so one email with a structure twice, or one brand's
 * resends, never counts on its own; a one-off is kept but not counted.
 */
export const libraryTarget = 2000
export const usefulBrands = 2
/** A family is thin while it holds fewer useful blocks than this share of an even split. */
const thinShare = 0.25

export type VariantRow = {
  family: string
  source: string
  /** Different brands whose emails showed this structure. */
  brands: number
  /** When the structure was first seen at its `usefulBrands`-th brand; null before. */
  becameUsefulAt: string | null
}

export type LibraryProgress = {
  target: number
  /** Every variant, seeds included. */
  variants: number
  seeds: number
  fromCompetitors: number
  /** Seeds, and structures seen at 2 or more brands: what counts toward the target. */
  useful: number
  /** `useful` as a share of the target (0 to 1, can pass 1). */
  progress: number
  /** Competitor variants that became useful in the last 7 days. */
  usefulLastWeek: number
  /** Every family, most useful first. */
  byFamily: { family: BlockType; variants: number; useful: number }[]
  /** Families well behind an even split of the target, thinnest first: where to collect next. */
  thinFamilies: BlockType[]
  /** False when the read stopped at its cap: the numbers are then a floor. */
  complete: boolean
}

/** The progress from the library's rows; rows of unknown families or sources are left out. */
export function libraryProgress(
  rows: readonly VariantRow[],
  {
    now = Date.now(),
    complete = true
  }: { now?: number; complete?: boolean } = {}
): LibraryProgress {
  const weekAgo = now - 7 * 86_400_000
  const families = new Map<BlockType, { variants: number; useful: number }>(
    blockTypes.map((f) => [f, { variants: 0, useful: 0 }])
  )
  let seeds = 0
  let fromCompetitors = 0
  let useful = 0
  let usefulLastWeek = 0
  for (const row of rows) {
    if (!isBlockType(row.family)) continue
    const seed = row.source === 'seed'
    if (!seed && row.source !== 'competitor') continue
    const counts =
      seed || (Number.isInteger(row.brands) && row.brands >= usefulBrands)
    const family = families.get(row.family)!
    family.variants++
    if (seed) seeds++
    else fromCompetitors++
    if (!counts) continue
    useful++
    family.useful++
    const became = row.becameUsefulAt ? Date.parse(row.becameUsefulAt) : NaN
    if (!seed && became >= weekAgo && became <= now) usefulLastWeek++
  }
  const evenShare = libraryTarget / blockTypes.length
  const byFamily = [...families.entries()]
    .map(([family, c]) => ({ family, ...c }))
    .sort(
      (a, b) =>
        b.useful - a.useful ||
        b.variants - a.variants ||
        a.family.localeCompare(b.family)
    )
  return {
    target: libraryTarget,
    variants: seeds + fromCompetitors,
    seeds,
    fromCompetitors,
    useful,
    progress: Math.round((useful / libraryTarget) * 1000) / 1000,
    usefulLastWeek,
    byFamily,
    thinFamilies: byFamily
      .filter((f) => f.useful < evenShare * thinShare)
      .sort((a, b) => a.useful - b.useful || a.family.localeCompare(b.family))
      .map((f) => f.family),
    complete
  }
}

type Db = SupabaseClient<Database>
const page = 1000
const maxVariants = 50_000
const maxSections = 250_000

/** Every row of a paged read, until an empty page or the cap; null on an error. */
async function readAll<T>(
  read: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  cap: number
): Promise<{ rows: T[]; complete: boolean } | null> {
  const rows: T[] = []
  while (rows.length < cap) {
    const result = await read(rows.length, rows.length + page - 1)
    if (result.error) return null
    const data = result.data ?? []
    if (data.length === 0) return { rows, complete: true }
    rows.push(...data)
  }
  return { rows, complete: false }
}

/**
 * The library's progress, read with an operator's client or the worker's
 * (variants and sections are operator-only). Null when a read fails, and
 * when no seed comes back: the 20 seeds always exist, so an empty read
 * means the caller may not read the library.
 */
export async function readLibraryProgress(
  db: Db,
  now = Date.now()
): Promise<LibraryProgress | null> {
  try {
    const variants = await readAll(
      (from, to) =>
        db
          .from('block_variants')
          .select('id,family,source')
          .order('created_at')
          .order('id')
          .range(from, to),
      maxVariants
    )
    if (!variants || !variants.rows.some((v) => v.source === 'seed'))
      return null
    const sections = await readAll(
      (from, to) =>
        db
          .from('email_sections')
          .select('id,variant_id,inbox_messages!inner(capture_id,received_at)')
          .not('variant_id', 'is', null)
          .order('id')
          .range(from, to),
      maxSections
    )
    if (!sections) return null
    // Each variant's sections by time, to find when its second brand appeared.
    const seen = new Map<string, { brand: string; at: string }[]>()
    for (const s of sections.rows) {
      const message = Array.isArray(s.inbox_messages)
        ? s.inbox_messages[0]
        : s.inbox_messages
      if (!s.variant_id || !message?.capture_id) continue
      const list = seen.get(s.variant_id) ?? []
      list.push({ brand: message.capture_id, at: message.received_at })
      seen.set(s.variant_id, list)
    }
    const rows: VariantRow[] = variants.rows.map((v) => {
      const list = (seen.get(v.id) ?? []).sort((a, b) =>
        a.at.localeCompare(b.at)
      )
      const brands = new Set<string>()
      let becameUsefulAt: string | null = null
      for (const s of list) {
        brands.add(s.brand)
        if (brands.size === usefulBrands && becameUsefulAt === null)
          becameUsefulAt = s.at
      }
      return {
        family: v.family,
        source: v.source,
        brands: brands.size,
        becameUsefulAt
      }
    })
    return libraryProgress(rows, {
      now,
      complete: variants.complete && sections.complete
    })
  } catch {
    return null
  }
}
