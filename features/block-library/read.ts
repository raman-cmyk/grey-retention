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
import { observerAllowed } from '@/features/inbox/observer-access'

type Db = SupabaseClient<Database>

/**
 * DES-ENGINE-004b: the block library as one workspace may use it, read
 * with the service role by server code that has already checked who is
 * asking (the build worker for its own build's workspace; the library
 * screen after `requireRequestContext`). One rule everywhere, Copy's rule
 * (`library_blocks_for`, migration 090107): blocks that passed the quality
 * gate, the workspace's own private ones (their upload still ready) and
 * shared ones used by an Inspiration email the workspace may use (a brand
 * it follows and has not hidden, or a sample email for a sample
 * workspace), then the Observer selection on top (`observerAllowed`: at
 * least one such email allowed; withdrawn and transactional ones never). Never
 * another workspace's private block, never where a block came from. Every
 * usable block is read (no cap); a block's blueprint (structure only, its
 * words blanked) is read only by the code that draws it.
 */

export const readLimits = {
  /** The workspace's last Scratch emails whose picks lower a block's rank. */
  recent: 10
} as const

export type WorkspaceBlock = LibraryBlock & { hidden: boolean }

const isKind = (k: string): k is BlockKind =>
  (blockKinds as readonly string[]).includes(k)

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type SourceEmail = {
  id: string
  message: string | null
  external_id: string | null
  synthetic: boolean | null
}

type ForRow = {
  id: string
  tenant_id: string | null
  kind: string
  facts: unknown
  uses: number
  brands: number
  email_types: string[] | null
  width: number | string | null
  hidden: boolean
  /** A shared block's emails the workspace may use (geometry's first). */
  emails: unknown
}

const emailsOf = (value: unknown): SourceEmail[] =>
  Array.isArray(value)
    ? value.filter(
        (e): e is SourceEmail =>
          !!e && typeof e === 'object' && typeof e.id === 'string'
      )
    : []

/**
 * Shared rows with at least one email the Observer selection allows (a
 * withdrawn or transactional email never counts); private rows only the
 * workspace's own.
 */
async function observed<
  T extends { tenant_id: string | null; emails: unknown }
>(rows: readonly T[], tenant: string): Promise<T[]> {
  const shared = rows.filter((r) => r.tenant_id === null)
  const allowed = new Set(
    (
      await observerAllowed(
        shared.flatMap((r) =>
          emailsOf(r.emails).map((e) => ({
            id: e.id,
            inbox_message_id: e.message,
            external_id: e.external_id ?? '',
            synthetic: e.synthetic === true
          }))
        )
      )
    ).map((e) => e.id)
  )
  return rows.filter((r) =>
    r.tenant_id === null
      ? emailsOf(r.emails).some((e) => allowed.has(e.id))
      : // A private block is the workspace's own, never another's.
        r.tenant_id === tenant
  )
}

/** The blocks this workspace may use (hidden ones too when asked). */
export async function workspaceLibrary(
  db: Db,
  tenant: string,
  { withHidden = false }: { withHidden?: boolean } = {}
): Promise<WorkspaceBlock[]> {
  if (!uuid.test(tenant)) throw new Error('workspace_invalid')
  const { data, error } = await db.rpc('library_blocks_for', {
    t: tenant,
    with_hidden: withHidden
  })
  if (error) throw error
  const rows = await observed((data ?? []) as ForRow[], tenant)
  return rows.flatMap((r) =>
    isKind(r.kind) && (withHidden || !r.hidden)
      ? [
          {
            id: r.id,
            kind: r.kind,
            facts: r.facts as BlockFacts,
            width: Number(r.width) || 0,
            uses: r.uses,
            brands: r.brands,
            emailTypes: r.email_types ?? [],
            yours: r.tenant_id === tenant,
            hidden: r.hidden
          }
        ]
      : []
  )
}

/** The blocks the workspace's last Scratch emails used (variety), this build's own left out. */
export async function recentPicks(
  db: Db,
  tenant: string,
  exceptBuild?: string
): Promise<string[]> {
  let query = db
    .from('email_copies')
    .select('build_id,tenant_id,blocks')
    .eq('tenant_id', tenant)
    .not('blocks', 'is', null)
  if (exceptBuild) query = query.neq('build_id', exceptBuild)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(readLimits.recent)
  if (error) throw error
  return (data ?? []).flatMap((r) =>
    r.tenant_id === tenant && r.build_id !== exceptBuild ? (r.blocks ?? []) : []
  )
}

/** The blocks a build's own Scratch copy already asked for, if any. */
export async function storedPick(
  db: Db,
  tenant: string,
  build: string
): Promise<string[] | null> {
  const { data, error } = await db
    .from('email_copies')
    .select('tenant_id,blocks')
    .eq('build_id', build)
    .eq('tenant_id', tenant)
    .maybeSingle()
  if (error) throw error
  return data && data.tenant_id === tenant && data.blocks?.length
    ? data.blocks
    : null
}

export type CheckedBlock = {
  id: string
  geometryMessage: string | null
  geometryUpload: string | null
}

/**
 * Which of the given blocks the workspace may still use (reference time:
 * the copy job checks again when it hands a Scratch copy out), each with
 * where its geometry came from.
 */
export async function checkedBlocks(
  db: Db,
  tenant: string,
  ids: readonly string[]
): Promise<CheckedBlock[]> {
  const { data, error } = await db.rpc('library_blocks_check', {
    t: tenant,
    blocks: [...ids]
  })
  if (error) throw error
  const rows = (data ?? []) as {
    id: string
    tenant_id: string | null
    geometry_message: string | null
    geometry_upload: string | null
    emails: unknown
  }[]
  return (await observed(rows, tenant)).map((r) => ({
    id: r.id,
    geometryMessage: r.geometry_message,
    geometryUpload: r.geometry_upload
  }))
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
    // Another workspace's private block is never drawn here.
    if (r.tenant_id !== null && r.tenant_id !== tenant) continue
    const parsed = parseBlueprint(r.blueprint)
    if (parsed.ok) out.set(r.id, parsed.blueprint)
  }
  return out
}
