import type { SupabaseClient } from '@supabase/supabase-js'
import { blockTypes, type BlockType } from '@/features/blocks/catalog'
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
 * only). Quality: a variant counts as a **useful block** when it is a seed
 * or its structure was seen at least `usefulEvidence` times; a one-off is
 * kept but not counted toward the target.
 */
export const libraryTarget = 2000
export const usefulEvidence = 2
/** A family is thin while it holds fewer useful blocks than this share of an even split. */
const thinShare = 0.25

export type VariantRow = {
  family: string
  source: string
  evidence: number
  created_at: string
}

export type LibraryProgress = {
  target: number
  /** Every variant, seeds included. */
  variants: number
  seeds: number
  fromCompetitors: number
  /** Seeds, and structures seen at least twice: what counts toward the target. */
  useful: number
  /** `useful` as a share of the target (0 to 1, can pass 1). */
  progress: number
  /** Useful variants added in the last 7 days (seeds left out). */
  usefulLastWeek: number
  /** Every family, most useful first. */
  byFamily: { family: BlockType; variants: number; useful: number }[]
  /** Families well behind an even split of the target: where to collect next. */
  thinFamilies: BlockType[]
}

const isFamily = (f: string): f is BlockType =>
  (blockTypes as readonly string[]).includes(f)

/** The progress from the library's rows; rows of unknown families are left out. */
export function libraryProgress(
  rows: readonly VariantRow[],
  { now = Date.now() }: { now?: number } = {}
): LibraryProgress {
  const weekAgo = now - 7 * 86_400_000
  const families = new Map<BlockType, { variants: number; useful: number }>(
    blockTypes.map((f) => [f, { variants: 0, useful: 0 }])
  )
  let variants = 0
  let seeds = 0
  let useful = 0
  let usefulLastWeek = 0
  for (const row of rows) {
    if (!isFamily(row.family)) continue
    const seed = row.source === 'seed'
    const counts =
      seed ||
      (row.source === 'competitor' &&
        Number.isInteger(row.evidence) &&
        row.evidence >= usefulEvidence)
    const family = families.get(row.family)!
    variants++
    family.variants++
    if (seed) seeds++
    if (counts) {
      useful++
      family.useful++
      const created = Date.parse(row.created_at)
      if (!seed && created >= weekAgo && created <= now) usefulLastWeek++
    }
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
    variants,
    seeds,
    fromCompetitors: variants - seeds,
    useful,
    progress: Math.round((useful / libraryTarget) * 1000) / 1000,
    usefulLastWeek,
    byFamily,
    thinFamilies: byFamily
      .filter((f) => f.useful < evenShare * thinShare)
      .map((f) => f.family)
      .sort((a, b) => a.localeCompare(b))
  }
}

type Db = SupabaseClient<Database>
/** More than the library will hold for a long while; read in pages of this size. */
const page = 1000
const maxRows = 20_000

/**
 * The library's progress, read with an operator's client or the worker's
 * (variants are operator-only). Null when a read fails.
 */
export async function readLibraryProgress(
  db: Db,
  now = Date.now()
): Promise<LibraryProgress | null> {
  const rows: VariantRow[] = []
  try {
    for (let from = 0; from < maxRows; from += page) {
      const read = await db
        .from('block_variants')
        .select('family,source,evidence,created_at')
        .order('created_at')
        .order('id')
        .range(from, from + page - 1)
      if (read.error) return null
      rows.push(...(read.data ?? []))
      if ((read.data ?? []).length < page) break
    }
  } catch {
    return null
  }
  return libraryProgress(rows, { now })
}
