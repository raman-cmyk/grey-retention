import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import type { DraftPusher } from '@/lib/providers/klaviyo-draft'
import { parseBlueprint } from '@/features/design-engine/blueprint'
import { photoOrigins } from '@/features/design-engine/photos'
import { ENGINE_VERSION } from '@/features/design-engine/stored'
import {
  copyInputSchema,
  copyPhotoPath,
  copyRecord,
  libraryCopyOn
} from './library-copy'
import { runEmailBuilds } from './worker'

/**
 * DES-ENGINE-002b2: the library copy browser job's side in the app. A
 * server function cannot run Chromium, so the scheduled browser job
 * (`scripts/design-copies.mjs`, `.github/workflows/design-copies.yml`)
 * asks for one copy at a time (`copyJobs`: what the build saved for it,
 * the stored blueprint, the original's marked HTML as a short-lived signed
 * link, signed upload links for its cut photos and the server's fixed list
 * of photo hosts), runs `libraryCopy` in the locked browser, uploads the
 * cut photos and reports the copy (`finishCopy`, `record_email_copy`).
 * Then the builds whose copies are in go on (`runCopiedBuilds`), through
 * their checks and into Klaviyo as drafts.
 */

type Db = SupabaseClient<Database>

export const copyLimits = {
  /** How long the signed links work (the original's HTML, the uploads). */
  linkSeconds: 600,
  /** A report's largest body (a copy is at most 400,000 characters). */
  bodyBytes: 450_000,
  /** Builds one carry-on run takes at most. */
  carryBuilds: 5
} as const

export type CopyJob = {
  job: string
  lease: string
  engine: string
  /** What the build saved for its copy (`copyInputSchema`). */
  input: unknown
  /** The stored blueprint of the inspiration email (no pictures or links). */
  source: unknown
  /** The original's marked HTML, for the leak check (signed link). */
  html: string
  /** Where each cut photo goes, by index (signed upload links). */
  uploads: { index: number; url: string }[]
  /** The hosts photos may be fetched from: the server's fixed list only. */
  origins: string[]
}

type Lease = { id: string; subject_key: string; lease_token: string }

async function retry(db: Db, job: string, lease: string, code: string) {
  const failed = await db.rpc('fail_platform_job', {
    job,
    lease,
    failure: code === 'timeout' ? 'timeout' : 'protocol',
    error_code: code
  })
  if (failed.error)
    logger.warn('Copy job failure not recorded', {
      code: failed.error.code ?? 'unknown',
      failure: code
    })
}

async function failCopy(db: Db, job: string, lease: string, failure: string) {
  const done = await db.rpc('record_email_copy', { job, lease, failure })
  if (done.error)
    logger.warn('Copy failure not recorded', {
      code: done.error.code ?? 'unknown',
      failure
    })
}

/** How many copies are due now (claims nothing). */
export async function copiesWaiting(db: Db) {
  const { count, error } = await db
    .from('platform_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'design.copy')
    .in('status', ['queued', 'retry_wait'])
    .lte('available_at', new Date().toISOString())
  if (error) throw error
  return count ?? 0
}

/**
 * Claims one copy job and signs what it needs. A browser on another
 * engine version gets none and nothing is claimed (`skew`). A copy that
 * can never be made (its input unreadable, the blueprint or the original
 * gone, the build moved on) is recorded as failed at once, with its code.
 */
export async function copyJobs(
  db: Db,
  engine: string | null
): Promise<{ jobs: CopyJob[]; skew: boolean }> {
  if (engine !== ENGINE_VERSION) return { jobs: [], skew: true }
  const claimed = await db.rpc('claim_email_copy')
  if (claimed.error) throw claimed.error
  const job = (claimed.data as unknown as Lease[] | null)?.[0]
  if (!job) return { jobs: [], skew: false }
  const handed = await handOut(db, job)
  return { jobs: handed ? [handed] : [], skew: false }
}

async function handOut(db: Db, job: Lease): Promise<CopyJob | null> {
  const copy = await db
    .from('email_copies')
    .select('build_id,tenant_id,inbox_message_id,state,input,photos')
    .eq('build_id', job.subject_key)
    .maybeSingle()
  if (copy.error) {
    await retry(db, job.id, job.lease_token, 'copy_read_failed')
    return null
  }
  if (!copy.data || copy.data.state !== 'queued') {
    // Nothing left to copy (recorded already, or gone with its build).
    const done = await db.rpc('finish_platform_job', {
      job: job.id,
      lease: job.lease_token,
      outcome: { state: copy.data?.state ?? 'gone' }
    })
    if (done.error)
      logger.warn('Copy job not settled', { code: done.error.code })
    return null
  }
  const c = copy.data
  const build = await db
    .from('email_builds')
    .select('state,step')
    .eq('id', c.build_id)
    .maybeSingle()
  if (build.error) {
    await retry(db, job.id, job.lease_token, 'copy_read_failed')
    return null
  }
  if (build.data?.state !== 'build_queued' || build.data.step !== 'design') {
    await failCopy(db, job.id, job.lease_token, 'build_moved_on')
    return null
  }
  if (!copyInputSchema.safeParse(c.input).success) {
    await failCopy(db, job.id, job.lease_token, 'input_invalid')
    return null
  }
  const [stored, message] = await Promise.all([
    db
      .from('inbox_blueprints')
      .select('state,blueprint')
      .eq('inbox_message_id', c.inbox_message_id)
      .eq('version', 1)
      .maybeSingle(),
    db
      .from('inbox_messages')
      .select('marked_html_path')
      .eq('id', c.inbox_message_id)
      .maybeSingle()
  ])
  if (stored.error || message.error) {
    await retry(db, job.id, job.lease_token, 'copy_read_failed')
    return null
  }
  if (
    stored.data?.state !== 'ready' ||
    !parseBlueprint(stored.data.blueprint).ok
  ) {
    await failCopy(db, job.id, job.lease_token, 'blueprint_gone')
    return null
  }
  if (!message.data?.marked_html_path) {
    await failCopy(db, job.id, job.lease_token, 'source_missing')
    return null
  }
  const html = await db.storage
    .from('inbox-raw')
    .createSignedUrl(message.data.marked_html_path, copyLimits.linkSeconds)
  if (html.error || !html.data?.signedUrl) {
    await retry(db, job.id, job.lease_token, 'copy_links_failed')
    return null
  }
  const uploads: CopyJob['uploads'] = []
  for (let index = 0; index < c.photos; index++) {
    const up = await db.storage
      .from('email-copies')
      .createSignedUploadUrl(copyPhotoPath(c.tenant_id, c.build_id, index), {
        upsert: true
      })
    if (up.error || !up.data?.signedUrl) {
      await retry(db, job.id, job.lease_token, 'copy_links_failed')
      return null
    }
    uploads.push({ index, url: up.data.signedUrl })
  }
  return {
    job: job.id,
    lease: job.lease_token,
    engine: ENGINE_VERSION,
    input: c.input,
    source: stored.data.blueprint,
    html: html.data.signedUrl,
    uploads,
    origins: photoOrigins()
  }
}

export const copyResult = z.union([
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    engine: z.string().min(1).max(40),
    record: copyRecord
  }),
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    engine: z.string().min(1).max(40),
    failure: z.enum(['copy_failed', 'too_many_photos'])
  }),
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    retry: z.enum(['timeout', 'html_unreadable', 'upload_failed'])
  })
])
export type CopyResult = z.infer<typeof copyResult>

/**
 * Records one result: the copy (every photo it names stored), a failure
 * that is final, or one worth another try. A copy made on another engine
 * version is handed back without counting a try.
 */
export async function finishCopy(
  db: Db,
  result: CopyResult
): Promise<{ ok: true; state: string } | { ok: false; code: string }> {
  if ('retry' in result) {
    await retry(db, result.job, result.lease, result.retry)
    return { ok: true, state: 'retry' }
  }
  if (result.engine !== ENGINE_VERSION) {
    const released = await db.rpc('release_email_copy', {
      job: result.job,
      lease: result.lease
    })
    if (released.error)
      return { ok: false, code: released.error.code ?? 'error' }
    return { ok: true, state: 'retry' }
  }
  const recorded = await db.rpc(
    'record_email_copy',
    'record' in result
      ? {
          job: result.job,
          lease: result.lease,
          result: result.record as unknown as Json
        }
      : { job: result.job, lease: result.lease, failure: result.failure }
  )
  if (recorded.error) return { ok: false, code: recorded.error.code ?? 'error' }
  return { ok: true, state: String(recorded.data) }
}

/**
 * The builds whose copies are in (recorded or failed in the last hour, the
 * design step waiting): each goes on now, through its checks and its push,
 * as the owner's click does. A build another job holds is left to it.
 */
export async function runCopiedBuilds(
  db: Db,
  deps: {
    deadline: number
    pusher?: DraftPusher
    env?: Readonly<Record<string, string | undefined>>
    now?: () => number
  }
): Promise<{ off: boolean; builds: number; ran: number }> {
  if (!libraryCopyOn(deps.env ?? process.env))
    return { off: true, builds: 0, ran: 0 }
  const now = deps.now ?? Date.now
  const { data, error } = await db
    .from('email_copies')
    .select('build_id')
    .in('state', ['done', 'failed'])
    .gte('updated_at', new Date(now() - 3_600_000).toISOString())
    .order('updated_at', { ascending: true })
    .limit(copyLimits.carryBuilds * 4)
  if (error) throw error
  const builds = await db
    .from('email_builds')
    .select('id')
    .in(
      'id',
      (data ?? []).map((r) => r.build_id)
    )
    .eq('state', 'build_queued')
    .eq('step', 'design')
    .limit(copyLimits.carryBuilds)
  if (builds.error) throw builds.error
  let ran = 0
  let n = 0
  for (const b of builds.data ?? []) {
    if (now() > deps.deadline) break
    n++
    const done = await runEmailBuilds(db, {
      build: b.id,
      library: true,
      deadline: deps.deadline,
      ...(deps.pusher ? { pusher: deps.pusher } : {}),
      now
    })
    ran += done.ran
  }
  return { off: false, builds: n, ran }
}
