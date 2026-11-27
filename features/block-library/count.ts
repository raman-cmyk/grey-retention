import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { blockTypes } from '@/features/blocks/catalog'
import { blockKinds, type BlockKind } from '@/features/design-engine/blocks'
import { libraryTarget } from '@/features/intelligence/library-progress'

/**
 * DES-ENGINE-004: the block library's count for the Admin, extending
 * BLK-S001's progress toward 2,000 (`libraryTarget`). BLK-SCALE-001 (what
 * counts as one block) is still the owner's open decision; until he
 * decides, **one block is one distinct structure**: sections whose
 * structural fingerprint is the same (the same kind, the same parts in the
 * same columns at about the same sizes; never their words, colours or
 * pictures) are one block, and how many sections share it is its use
 * count. Only blocks that pass the quality gate (a safe size, drawn back
 * like their source section) count toward the target, with the 20 coded
 * seed blocks. A workspace's private blocks (its own uploads) are shown
 * apart and never counted toward the shared library.
 */

export type BlockCountRow = {
  source: string
  kind: string
  quality: string
  blocks: number
  uses: number
  reused: number
  two_brands: number
}

export type BlockLibraryCount = {
  target: number
  seeds: number
  /** Shared blocks from the Inspiration inbox that pass the quality gate. */
  inbox: number
  /** Private blocks (workspaces' own uploads) that pass, all workspaces. */
  private: number
  /** Seeds plus the inbox blocks that pass: what counts toward the target. */
  counted: number
  progress: number
  /** Sections that became blocks (the uses of every block that passes). */
  sections: number
  /** Sections folded into a block that already had their structure. */
  merged: number
  /** Inbox blocks used by two brands or more: BLK-S001's stricter "useful" count. */
  twoBrands: number
  /** Blocks used more than once ("this layout is used a lot"). */
  reused: number
  /** Blocks that did not pass the quality gate (kept out of Scratch). */
  failed: number
  byKind: {
    kind: BlockKind
    inbox: number
    private: number
    uses: number
  }[]
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function blockLibraryCount(
  rows: readonly BlockCountRow[]
): BlockLibraryCount {
  const seeds = blockTypes.length
  const passed = rows.filter((r) => r.quality === 'passed')
  const sum = (list: readonly BlockCountRow[], key: keyof BlockCountRow) =>
    list.reduce((n, r) => n + num(r[key]), 0)
  const inboxRows = passed.filter((r) => r.source === 'inbox')
  const privateRows = passed.filter((r) => r.source === 'upload')
  const inbox = sum(inboxRows, 'blocks')
  const sections = sum(passed, 'uses')
  const blocks = sum(passed, 'blocks')
  const counted = seeds + inbox
  return {
    target: libraryTarget,
    seeds,
    inbox,
    private: sum(privateRows, 'blocks'),
    counted,
    progress: Math.round((counted / libraryTarget) * 1000) / 1000,
    sections,
    merged: Math.max(0, sections - blocks),
    twoBrands: sum(inboxRows, 'two_brands'),
    reused: sum(passed, 'reused'),
    failed: sum(
      rows.filter((r) => r.quality === 'failed'),
      'blocks'
    ),
    byKind: blockKinds
      .map((kind) => ({
        kind,
        inbox: sum(
          inboxRows.filter((r) => r.kind === kind),
          'blocks'
        ),
        private: sum(
          privateRows.filter((r) => r.kind === kind),
          'blocks'
        ),
        uses: sum(
          passed.filter((r) => r.kind === kind),
          'uses'
        )
      }))
      .filter((k) => k.inbox || k.private)
      .sort((a, b) => b.inbox - a.inbox || a.kind.localeCompare(b.kind))
  }
}

/** The count, read by a platform operator (null when it cannot be read). */
export async function readBlockLibraryCount(
  db: SupabaseClient<Database>
): Promise<BlockLibraryCount | null> {
  const { data, error } = await db.rpc('library_block_counts')
  if (error) return null
  return blockLibraryCount((data ?? []) as BlockCountRow[])
}

/** Plain words for the kinds, as the Admin and the library screen say them. */
export const kindWords: Record<BlockKind, string> = {
  header: 'Headers',
  hero: 'Heroes',
  text: 'Text',
  image: 'Pictures',
  button: 'Buttons',
  product_grid: 'Product grids',
  columns: 'Columns',
  offer: 'Offers',
  social: 'Social links',
  footer: 'Footers',
  mixed: 'Mixed'
}
