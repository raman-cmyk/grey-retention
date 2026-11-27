import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import {
  parseBlueprint,
  type Blueprint
} from '@/features/design-engine/blueprint'
import {
  cutBlocks,
  type BlockCandidate,
  type BlockFailure
} from '@/features/design-engine/blocks'
import { ENGINE_VERSION } from '@/features/design-engine/stored'

type Db = SupabaseClient<Database>

/**
 * DES-ENGINE-004: the block job's side in the app, as the inbox
 * blueprints' and the uploads' (`features/inbox/blueprints.ts`). A server
 * function cannot run Chromium, so the scheduled design copies job
 * (`scripts/design-blocks.mjs`) asks for one source at a time: an
 * Inspiration email's stored blueprint, or a workspace's ready upload.
 * The app cuts it into blocks itself (`cutBlocks`) and hands out only the
 * sections whose structure the library does not have yet and that are a
 * safe size, each as its section on its own; the browser draws each back
 * and says whether it looks like its source. `finishBlocks` cuts the
 * stored blueprint again (never trusting a block the browser sends: it
 * sends only a verdict per section) and records every block with its
 * quality, once per section (`record_library_blocks`).
 */

export const blockJobLimits = {
  /** A report's largest body: a verdict per section (at most 40). */
  bodyBytes: 20_000
}

export type BlockJob = {
  job: string
  lease: string
  engine: string
  /** The sections to draw back: each on its own, with its stored words. */
  checks: { ordinal: number; blueprint: Blueprint }[]
}

type Claimed = {
  id: string
  subject_key: string
  lease_token: string
  tenant_id: string | null
  blueprint: unknown
}

async function retry(db: Db, job: string, lease: string, code: string) {
  const failed = await db.rpc('fail_platform_job', {
    job,
    lease,
    failure: code === 'timeout' ? 'timeout' : 'protocol',
    error_code: code
  })
  if (failed.error)
    logger.warn('Block job failure not recorded', {
      code: failed.error.code ?? 'unknown',
      failure: code
    })
}

/** How many sources wait for their blocks (claims nothing). */
export async function blocksWaiting(db: Db) {
  const { data, error } = await db.rpc('library_block_jobs_waiting')
  if (error) throw error
  return Number(data ?? 0)
}

/** Fingerprints the source's scope already has, passed. */
async function known(
  db: Db,
  tenant: string | null,
  blocks: readonly BlockCandidate[]
): Promise<Set<string> | null> {
  if (!blocks.length) return new Set()
  const got = await db.rpc('known_library_blocks', {
    // A shared block has no workspace (SQL null).
    t: tenant as string,
    prints: [...new Set(blocks.map((b) => b.fingerprint))]
  })
  if (got.error) return null
  return new Set((got.data ?? []) as string[])
}

/**
 * One source to cut into blocks, or none: none to a browser on another
 * engine version (`skew`: nothing claimed). A source whose blueprint is
 * no longer one is recorded with no blocks. Every section the library
 * already has, and every one of an unsafe size, is recorded without a
 * drawing.
 */
export async function blockJobs(
  db: Db,
  engine: string | null
): Promise<{ jobs: BlockJob[]; skew: boolean }> {
  if (engine !== ENGINE_VERSION) return { jobs: [], skew: true }
  const claimed = await db.rpc('claim_library_blocks')
  if (claimed.error) throw claimed.error
  const job = (claimed.data as unknown as Claimed[] | null)?.[0]
  if (!job) return { jobs: [], skew: false }
  const parsed = parseBlueprint(job.blueprint)
  const cut = parsed.ok ? cutBlocks(parsed.blueprint) : null
  const have = cut
    ? await known(db, job.tenant_id, cut.blocks)
    : new Set<string>()
  if (!have) {
    await retry(db, job.id, job.lease_token, 'blocks_read_failed')
    return { jobs: [], skew: false }
  }
  const checks = (cut?.blocks ?? []).filter(
    (b) => !b.unsafe && !have.has(b.fingerprint)
  )
  if (!checks.length) {
    // Nothing to draw: recorded now (every block known, unsafe or none).
    const done = await record(db, job.id, job.lease_token, cut, have, [])
    if (!done.ok) logger.warn('Blocks not recorded', { code: done.code })
    return { jobs: [], skew: false }
  }
  // Each structure is drawn once, even when the email has it twice.
  const seen = new Set<string>()
  return {
    jobs: [
      {
        job: job.id,
        lease: job.lease_token,
        engine: ENGINE_VERSION,
        checks: checks
          .filter((b) => !seen.has(b.fingerprint) && seen.add(b.fingerprint))
          .map((b) => ({ ordinal: b.ordinal, blueprint: b.check }))
      }
    ],
    skew: false
  }
}

export const blockResult = z.union([
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    engine: z.string().min(1).max(40),
    checks: z
      .array(
        z.object({
          ordinal: z.int().min(1).max(40),
          pass: z.boolean(),
          failure: z.enum(['not_alike', 'not_drawn']).optional()
        })
      )
      .max(40)
  }),
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    retry: z.enum(['timeout', 'engine_error'])
  })
])
export type BlockResult = z.infer<typeof blockResult>

type Verdict = { pass: boolean; failure?: 'not_alike' | 'not_drawn' }

/** The blocks as the command records them: quality from size, the library, or the browser. */
export function blockRows(
  cut: { blocks: readonly BlockCandidate[] } | null,
  have: ReadonlySet<string>,
  verdicts: ReadonlyMap<string, Verdict>
) {
  return (cut?.blocks ?? []).map((b) => {
    const failure: BlockFailure | null = b.unsafe
      ? b.unsafe
      : have.has(b.fingerprint)
        ? null
        : (() => {
            const v = verdicts.get(b.fingerprint)
            if (!v) return 'not_checked'
            return v.pass ? null : (v.failure ?? 'not_alike')
          })()
    return {
      ordinal: b.ordinal,
      fingerprint: b.fingerprint,
      kind: b.kind,
      roles: b.roles,
      facts: b.facts,
      blueprint: b.blueprint,
      quality: failure ? 'failed' : 'passed',
      failure
    }
  })
}

async function record(
  db: Db,
  job: string,
  lease: string,
  cut: { blocks: readonly BlockCandidate[] } | null,
  have: ReadonlySet<string>,
  checks: readonly ({ ordinal: number } & Verdict)[]
): Promise<{ ok: true; state: string } | { ok: false; code: string }> {
  // A verdict is the browser's word for a section; it counts for that
  // section's structure (each structure is drawn once).
  const byOrdinal = new Map(checks.map((c) => [c.ordinal, c]))
  const verdicts = new Map<string, Verdict>()
  for (const b of cut?.blocks ?? []) {
    const v = byOrdinal.get(b.ordinal)
    if (v && !verdicts.has(b.fingerprint)) verdicts.set(b.fingerprint, v)
  }
  const done = await db.rpc('record_library_blocks', {
    job,
    lease,
    blocks: blockRows(cut, have, verdicts) as unknown as Json
  })
  if (done.error) return { ok: false, code: done.error.code ?? 'error' }
  const state = (done.data as { state?: string } | null)?.state ?? 'done'
  return { ok: true, state }
}

/**
 * Records one result: the stored blueprint cut again here, each section
 * with its quality. A result made on another engine version is tried
 * again later (no verdict of another version is kept).
 */
export async function finishBlocks(
  db: Db,
  result: BlockResult
): Promise<{ ok: true; state: string } | { ok: false; code: string }> {
  if ('retry' in result) {
    await retry(db, result.job, result.lease, result.retry)
    return { ok: true, state: 'retry' }
  }
  if (result.engine !== ENGINE_VERSION) {
    await retry(db, result.job, result.lease, 'version_skew')
    return { ok: true, state: 'retry' }
  }
  const job = await db
    .from('platform_jobs')
    .select('subject_key')
    .eq('id', result.job)
    .eq('kind', 'design.blocks')
    .maybeSingle()
  if (job.error) return { ok: false, code: job.error.code ?? 'error' }
  if (!job.data) return { ok: false, code: 'PT409' }
  const [what, id] = job.data.subject_key.split(':')
  let blueprint: unknown = null
  let tenant: string | null = null
  if (what === 'inbox') {
    const row = await db
      .from('inbox_blueprints')
      .select('blueprint')
      .eq('inbox_message_id', id!)
      .eq('version', 1)
      .eq('state', 'ready')
      .maybeSingle()
    if (row.error) return { ok: false, code: row.error.code ?? 'error' }
    blueprint = row.data?.blueprint ?? null
  } else {
    const row = await db
      .from('email_uploads')
      .select('blueprint,tenant_id')
      .eq('id', id!)
      .eq('state', 'ready')
      .maybeSingle()
    if (row.error) return { ok: false, code: row.error.code ?? 'error' }
    blueprint = row.data?.blueprint ?? null
    tenant = row.data?.tenant_id ?? null
  }
  const parsed = parseBlueprint(blueprint)
  const cut = parsed.ok ? cutBlocks(parsed.blueprint) : null
  const have = cut ? await known(db, tenant, cut.blocks) : new Set<string>()
  if (!have) return { ok: false, code: 'blocks_read_failed' }
  return record(db, result.job, result.lease, cut, have, result.checks)
}
