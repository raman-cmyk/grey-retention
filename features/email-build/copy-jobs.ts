import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import type { DraftPusher } from '@/lib/providers/klaviyo-draft'
import { parseBlueprint } from '@/features/design-engine/blueprint'
import { leaksOf } from '@/features/design-engine/leaks'
import { photoOrigins } from '@/features/design-engine/photos'
import { ENGINE_VERSION } from '@/features/design-engine/stored'
import { swapOwnWords, type SwapBrand } from '@/features/design-engine/swap'
import {
  copyInputSchema,
  copyPhotoPath,
  copyRecord,
  libraryCopyOn,
  type CopyRecord
} from './library-copy'
import { runEmailBuilds } from './worker'

/**
 * DES-ENGINE-002b2: the library copy browser job's side in the app. A
 * server function cannot run Chromium, so the scheduled browser job
 * (`scripts/design-copies.mjs`, `.github/workflows/design-copies.yml`)
 * asks for one copy at a time (`copyJobs`: what the build saved for it,
 * the stored blueprint, the original's marked HTML as a short-lived signed
 * link, signed upload links in its own claim's folder and the server's
 * fixed list of photo hosts), runs `libraryCopy` in the locked browser,
 * uploads the cut photos and reports the copy (`finishCopy`). The app
 * runs the leak check again itself before it records a copy: rule 8 never
 * rests on the browser job's word. Then the builds whose copies are in go
 * on (`runCopiedBuilds`), through their checks and into Klaviyo as drafts,
 * and the photos no email needs any more are removed (`cleanCopyPhotos`).
 * With the owner's switch off, the job is handed no work.
 */

type Db = SupabaseClient<Database>
type Env = Readonly<Record<string, string | undefined>>

export const copyLimits = {
  /**
   * How long the link to the original's marked HTML works. The upload
   * links are Supabase's own (2 hours, fixed), each in its claim's own
   * folder and never over a stored photo.
   */
  linkSeconds: 600,
  /** A report's largest body (a copy is at most 400,000 characters). */
  bodyBytes: 450_000,
  /** Builds one carry-on run takes at most. */
  carryBuilds: 5,
  /** Copies whose photos one carry-on run looks at (cleanup). */
  cleanCopies: 20,
  /** A drafted email's cut photos are kept this long (their links' life). */
  keepDays: 30
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

/** How many copies are due now (claims nothing); none with the switch off. */
export async function copiesWaiting(db: Db, env: Env = process.env) {
  if (!libraryCopyOn(env)) return 0
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
 * Claims one copy job and signs what it needs. With the switch off, or to
 * a browser on another engine version, none: nothing is claimed (`skew`
 * says which). A copy that can never be made (its input unreadable, the
 * blueprint or the original gone, the build moved on) is recorded as
 * failed at once, with its code.
 */
export async function copyJobs(
  db: Db,
  engine: string | null,
  env: Env = process.env
): Promise<{ jobs: CopyJob[]; skew: boolean; off?: true }> {
  if (!libraryCopyOn(env)) return { jobs: [], skew: false, off: true }
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
  const sources = await copySources(db, c.inbox_message_id, { html: false })
  if (sources === 'unreadable') {
    await retry(db, job.id, job.lease_token, 'copy_read_failed')
    return null
  }
  if (sources === 'blueprint_gone' || sources === 'source_missing') {
    await failCopy(db, job.id, job.lease_token, sources)
    return null
  }
  const html = await db.storage
    .from('inbox-raw')
    .createSignedUrl(sources.path, copyLimits.linkSeconds)
  if (html.error || !html.data?.signedUrl) {
    await retry(db, job.id, job.lease_token, 'copy_links_failed')
    return null
  }
  const uploads: CopyJob['uploads'] = []
  for (let index = 0; index < c.photos; index++) {
    // In this claim's own folder, never over a stored photo.
    const up = await db.storage
      .from('email-copies')
      .createSignedUploadUrl(
        copyPhotoPath(c.tenant_id, c.build_id, job.lease_token, index)
      )
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
    source: sources.blueprint,
    html: html.data.signedUrl,
    uploads,
    origins: photoOrigins()
  }
}

/** The inspiration email's stored blueprint and marked HTML (its path, or its text). */
async function copySources(
  db: Db,
  message: string,
  { html }: { html: boolean }
): Promise<
  | { blueprint: unknown; path: string; text: string | null }
  | 'blueprint_gone'
  | 'source_missing'
  | 'unreadable'
> {
  const [stored, row] = await Promise.all([
    db
      .from('inbox_blueprints')
      .select('state,blueprint')
      .eq('inbox_message_id', message)
      .eq('version', 1)
      .maybeSingle(),
    db
      .from('inbox_messages')
      .select('marked_html_path')
      .eq('id', message)
      .maybeSingle()
  ])
  if (stored.error || row.error) return 'unreadable'
  if (
    stored.data?.state !== 'ready' ||
    !parseBlueprint(stored.data.blueprint).ok
  )
    return 'blueprint_gone'
  const path = row.data?.marked_html_path
  if (!path) return 'source_missing'
  if (!html) return { blueprint: stored.data.blueprint, path, text: null }
  const file = await db.storage.from('inbox-raw').download(path)
  if (file.error || !file.data) return 'unreadable'
  return {
    blueprint: stored.data.blueprint,
    path,
    text: await file.data.text()
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
    retry: z.enum([
      'timeout',
      'html_unreadable',
      'upload_failed',
      'engine_error'
    ])
  })
])
export type CopyResult = z.infer<typeof copyResult>

/**
 * Rule 8 checked again by the app: the copy against the stored blueprint,
 * the original's own HTML and the brand's vocabulary as the build saved
 * it. Null when it cannot be checked now (read again later).
 */
async function serverLeaks(
  db: Db,
  job: string,
  record: CopyRecord
): Promise<{ leaks: number } | 'gone' | null> {
  const j = await db
    .from('platform_jobs')
    .select('subject_key')
    .eq('id', job)
    .eq('kind', 'design.copy')
    .maybeSingle()
  if (j.error) return null
  if (!j.data) return 'gone'
  const copy = await db
    .from('email_copies')
    .select('inbox_message_id,input')
    .eq('build_id', j.data.subject_key)
    .maybeSingle()
  if (copy.error) return null
  if (!copy.data) return 'gone'
  const input = copyInputSchema.safeParse(copy.data.input)
  if (!input.success) return { leaks: 1 }
  const sources = await copySources(db, copy.data.inbox_message_id, {
    html: true
  })
  if (sources === 'unreadable') return null
  if (typeof sources === 'string' || !sources.text) return { leaks: 1 }
  const parsed = parseBlueprint(sources.blueprint)
  try {
    return {
      leaks: leaksOf({
        ...(parsed.ok ? { source: parsed.blueprint } : {}),
        sourceHtml: sources.text,
        html: record.html,
        sourceNames: input.data.sourceNames,
        vocabulary: [
          ...input.data.vocabulary,
          ...swapOwnWords(input.data.brand as unknown as SwapBrand)
        ]
      }).length
    }
  } catch {
    return { leaks: 1 }
  }
}

/**
 * Records one result: the copy (checked for leaks again here, every photo
 * it names stored in its claim's folder), a failure that is final, or one
 * worth another try. A copy made on another engine version is handed back
 * without counting a try. A copy that shows anything of the other brand
 * is recorded as failed (`copy_leaked`), never as a copy.
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
  let failure: string | null = 'failure' in result ? result.failure : null
  if ('record' in result) {
    const checked = result.record.leaks.length
      ? { leaks: result.record.leaks.length }
      : await serverLeaks(db, result.job, result.record)
    if (checked === null) return { ok: false, code: 'leak_check_unavailable' }
    if (checked === 'gone') return { ok: false, code: 'PT409' }
    if (checked.leaks) failure = 'copy_leaked'
  }
  const recorded = await db.rpc(
    'record_email_copy',
    failure === null && 'record' in result
      ? {
          job: result.job,
          lease: result.lease,
          result: result.record as unknown as Json
        }
      : { job: result.job, lease: result.lease, failure: failure! }
  )
  if (recorded.error) return { ok: false, code: recorded.error.code ?? 'error' }
  return { ok: true, state: String(recorded.data) }
}

/**
 * The builds whose copies are in (recorded or failed in the last hour, the
 * design step waiting): each goes on now, through its checks and its push,
 * as the owner's click does. A build another job holds is left to it.
 * Then the photos no email needs any more are removed.
 */
export async function runCopiedBuilds(
  db: Db,
  deps: {
    deadline: number
    pusher?: DraftPusher
    env?: Env
    now?: () => number
  }
): Promise<{ off: boolean; builds: number; ran: number; cleaned: number }> {
  if (!libraryCopyOn(deps.env ?? process.env))
    return { off: true, builds: 0, ran: 0, cleaned: 0 }
  const now = deps.now ?? Date.now
  const { data, error } = await db
    .from('email_copies')
    .select('build_id')
    .in('state', ['done', 'failed'])
    .gte('updated_at', new Date(now() - 3_600_000).toISOString())
    .order('updated_at', { ascending: true })
    .limit(copyLimits.carryBuilds * 4)
  if (error) throw error
  const ids = (data ?? []).map((r) => r.build_id)
  const builds = ids.length
    ? await db
        .from('email_builds')
        .select('id')
        .in('id', ids)
        .eq('state', 'build_queued')
        .eq('step', 'design')
        .limit(copyLimits.carryBuilds)
    : { data: [], error: null }
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
  const cleaned =
    now() < deps.deadline
      ? await cleanCopyPhotos(db, { now }).catch((e: { code?: string }) => {
          logger.warn('Copy photos not cleaned', { code: e?.code ?? 'error' })
          return 0
        })
      : 0
  return { off: false, builds: n, ran, cleaned }
}

/**
 * Removes the cut photos no email needs any more, once each (idempotent:
 * `clean_email_copy` marks the copy): a copy that failed, a build that
 * failed or is gone, an email drawn with coded blocks instead, and a
 * drafted copy's photos after their links' 30 days (Klaviyo keeps its own
 * imported copies). Copies whose build is still being made are left.
 */
export async function cleanCopyPhotos(
  db: Db,
  { now = Date.now }: { now?: () => number } = {}
): Promise<number> {
  const old = now() - copyLimits.keepDays * 86_400_000
  const since = new Date(old).toISOString()
  // The oldest past their 30 days, and the newest (an email that just
  // fell back to coded blocks): kept emails never block the others.
  const pick = () =>
    db
      .from('email_copies')
      .select('build_id,tenant_id,state,updated_at')
      .is('cleaned_at', null)
      .neq('state', 'queued')
  const [past, recent] = await Promise.all([
    pick()
      .lt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(copyLimits.cleanCopies),
    pick()
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
      .limit(copyLimits.cleanCopies)
  ])
  if (past.error) throw past.error
  if (recent.error) throw recent.error
  const copies = [
    ...new Map(
      [...(past.data ?? []), ...(recent.data ?? [])].map((c) => [c.build_id, c])
    ).values()
  ]
  if (!copies.length) return 0
  const builds = await db
    .from('email_builds')
    .select('id,state,library:email->library')
    .in(
      'id',
      copies.map((c) => c.build_id)
    )
  if (builds.error) throw builds.error
  const byId = new Map(
    (builds.data as { id: string; state: string; library: unknown }[]).map(
      (b) => [b.id, b]
    )
  )
  let cleaned = 0
  for (const c of copies) {
    const b = byId.get(c.build_id)
    const unneeded =
      c.state === 'failed' ||
      !b ||
      b.state === 'failed' ||
      (b.state !== 'build_queued' && !b.library) ||
      (!!b.library && Date.parse(c.updated_at) < old)
    if (!unneeded) continue
    const files = db.storage.from('email-copies')
    const folder = `${c.tenant_id}/${c.build_id}`
    const claims = await files.list(folder, { limit: 100 })
    if (claims.error) throw claims.error
    const paths: string[] = []
    for (const entry of claims.data ?? []) {
      // A claim's folder (no id) holds its photos; a file is one itself.
      if (entry.id) {
        paths.push(`${folder}/${entry.name}`)
        continue
      }
      const inside = await files.list(`${folder}/${entry.name}`, { limit: 100 })
      if (inside.error) throw inside.error
      for (const f of inside.data ?? [])
        paths.push(`${folder}/${entry.name}/${f.name}`)
    }
    if (paths.length) {
      const removed = await files.remove(paths)
      if (removed.error) throw removed.error
    }
    const marked = await db.rpc('clean_email_copy', { build: c.build_id })
    if (marked.error) throw marked.error
    cleaned++
  }
  return cleaned
}
