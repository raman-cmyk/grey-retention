import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import {
  blockKinds,
  type BlockFacts,
  type BlockKind
} from '@/features/design-engine/blocks'
import {
  parseBlueprint,
  type Blueprint
} from '@/features/design-engine/blueprint'
import type { LibraryBlock } from '@/features/email-build/scratch'

type Db = SupabaseClient<Database>

/**
 * DES-ENGINE-004b: the block library as one workspace may use it, read
 * with the service role by server code that has already checked who is
 * asking (the build worker for its own build's workspace; the library
 * screen after `requireRequestContext`): the blocks that passed the
 * quality gate, shared or the workspace's own private ones, most used
 * first, with the workspace's hidden layouts marked. Never another
 * workspace's private block, never where a block came from. A block's
 * blueprint (structure only, its words blanked) is read only by the code
 * that draws it in the brand's look.
 */

export const readLimits = {
  /** Blocks one read takes at most (the most used first). */
  blocks: 600,
  /** The workspace's last Scratch emails whose picks lower a block's rank. */
  recent: 10
} as const

export type WorkspaceBlock = LibraryBlock & { hidden: boolean }

const isKind = (k: string): k is BlockKind =>
  (blockKinds as readonly string[]).includes(k)

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function workspaceLibrary(
  db: Db,
  tenant: string
): Promise<WorkspaceBlock[]> {
  // The workspace's id goes into the filter: only ever a uuid.
  if (!uuid.test(tenant)) throw new Error('workspace_invalid')
  const [rows, hides] = await Promise.all([
    db
      .from('library_blocks')
      .select(
        'id,tenant_id,kind,facts,uses,brands,email_types,width:blueprint->width'
      )
      .eq('quality', 'passed')
      .or(`tenant_id.is.null,tenant_id.eq.${tenant}`)
      .order('uses', { ascending: false })
      .order('id')
      .limit(readLimits.blocks),
    db.from('library_block_hides').select('block_id').eq('tenant_id', tenant)
  ])
  if (rows.error) throw rows.error
  if (hides.error) throw hides.error
  const hidden = new Set((hides.data ?? []).map((h) => h.block_id))
  return (rows.data ?? []).flatMap((r) => {
    // Another workspace's private block never comes back (the filter), and
    // is refused here too.
    if (r.tenant_id !== null && r.tenant_id !== tenant) return []
    if (!isKind(r.kind)) return []
    return [
      {
        id: r.id,
        kind: r.kind,
        facts: r.facts as unknown as BlockFacts,
        width: Number(r.width) || 0,
        uses: r.uses,
        brands: r.brands,
        emailTypes: r.email_types ?? [],
        yours: r.tenant_id === tenant,
        hidden: hidden.has(r.id)
      }
    ]
  })
}

/** The blocks the workspace's last Scratch emails used (variety). */
export async function recentPicks(db: Db, tenant: string): Promise<string[]> {
  const { data, error } = await db
    .from('email_copies')
    .select('blocks')
    .eq('tenant_id', tenant)
    .not('blocks', 'is', null)
    .order('created_at', { ascending: false })
    .limit(readLimits.recent)
  if (error) throw error
  return (data ?? []).flatMap((r) => r.blocks ?? [])
}

/** The blueprints of blocks the workspace may use, in the order asked. */
export async function blockBlueprints(
  db: Db,
  tenant: string,
  ids: readonly string[]
): Promise<Map<string, Blueprint>> {
  if (!ids.length) return new Map()
  const { data, error } = await db
    .from('library_blocks')
    .select('id,tenant_id,blueprint')
    .in('id', [...ids])
    .eq('quality', 'passed')
  if (error) throw error
  const out = new Map<string, Blueprint>()
  for (const r of data ?? []) {
    if (r.tenant_id !== null && r.tenant_id !== tenant) continue
    const parsed = parseBlueprint(r.blueprint)
    if (parsed.ok) out.set(r.id, parsed.blueprint)
  }
  return out
}
