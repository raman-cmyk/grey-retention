import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import type { Blueprint } from '@/features/design-engine/blueprint'
import {
  blueprintFailures,
  ENGINE_VERSION,
  type BlueprintFailure
} from '@/features/design-engine/stored'
import { removeUpload, uploadBucket } from './intake'
import type { UploadDesign } from './limits'
import { checkUpload } from './measure'
import { uploadCopyOn } from './switch'

type Db = SupabaseClient<Database>

/**
 * DES-ENGINE-003: the upload measuring job's side in the app, as the
 * inbox blueprints' (`features/inbox/blueprints.ts`). A server function
 * cannot run Chromium, so the scheduled browser job asks for one upload at
 * a time (`uploadJobs`: its prepared HTML as a short-lived signed link,
 * whose kind it is and how many pictures it keeps; nothing else), measures
 * it and reports the blueprint; `finishUpload` checks it again for that
 * upload's kind (another brand's: no picture, no link) and stores it once.
 * Nothing is handed out with the owner's switch off.
 */

export const uploadJobLimits = {
  linkSeconds: 600,
  /**
   * A report's largest body: a kept blueprint is at most 500,000 bytes
   * (`storedLimit`), and a larger one is refused here as too large to
   * keep, never as an unreadable report the job would try again.
   */
  bodyBytes: 2_000_000
}

export type UploadJob = {
  job: string
  lease: string
  design: UploadDesign
  /** How many pictures it keeps (own design). */
  pictures: number
  /** The prepared HTML (our own marks). */
  html: string
  /** Its pinned tag: the job measures only those very bytes. */
  etag: string
}

async function fail(db: Db, job: string, lease: string, code: string) {
  const failed = await db.rpc('fail_platform_job', {
    job,
    lease,
    failure: code === 'timeout' ? 'timeout' : 'protocol',
    error_code: code
  })
  if (failed.error)
    logger.warn('Upload job failure not recorded', {
      code: failed.error.code ?? 'unknown',
      failure: code
    })
}

/**
 * How many uploads wait to be measured, of active workspaces, plus the
 * uploads to clean (claims nothing).
 */
export async function uploadsWaiting(
  db: Db,
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  if (!uploadCopyOn(env)) return 0
  const [jobs, clean] = await Promise.all([
    db.rpc('email_upload_jobs_waiting'),
    db
      .from('email_uploads')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'deleting')
  ])
  if (jobs.error) throw jobs.error
  if (clean.error) throw clean.error
  return Number(jobs.data ?? 0) + (clean.count ?? 0)
}

type Claimed = {
  id: string
  subject_key: string
  lease_token: string
  tenant_id: string
  design: string
  pictures: number
  html_etag: string | null
}

/**
 * One upload to measure, or none: none with the switch off (`off`) or to
 * a browser on another engine version (`skew`: nothing claimed).
 */
export async function uploadJobs(
  db: Db,
  engine: string | null,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<{ jobs: UploadJob[]; skew: boolean; off?: boolean }> {
  if (!uploadCopyOn(env)) return { jobs: [], skew: false, off: true }
  if (engine !== ENGINE_VERSION) return { jobs: [], skew: true }
  const claimed = await db.rpc('claim_email_upload')
  if (claimed.error) throw claimed.error
  const job = (claimed.data as unknown as Claimed[] | null)?.[0]
  if (!job) return { jobs: [], skew: false }
  // The prepared HTML as it was pinned when the upload was finished: a
  // file that changed since is never measured.
  const folder = `${job.tenant_id}/${job.subject_key}`
  const listed = await db.storage
    .from(uploadBucket)
    .list(folder, { search: 'email.html' })
  if (listed.error) {
    await fail(db, job.id, job.lease_token, 'upload_link_failed')
    return { jobs: [], skew: false }
  }
  const now = listed.data.find((o) => o.name === 'email.html')
  if (!now || !job.html_etag || now.metadata?.eTag !== job.html_etag) {
    const recorded = await db.rpc('record_email_upload', {
      job: job.id,
      lease: job.lease_token,
      failure: 'file_changed'
    })
    if (recorded.error)
      logger.warn('Changed upload not recorded', {
        code: recorded.error.code ?? 'unknown'
      })
    return { jobs: [], skew: false }
  }
  const link = await db.storage
    .from(uploadBucket)
    .createSignedUrl(`${folder}/email.html`, uploadJobLimits.linkSeconds)
  if (link.error || !link.data) {
    await fail(db, job.id, job.lease_token, 'upload_link_failed')
    return { jobs: [], skew: false }
  }
  return {
    jobs: [
      {
        job: job.id,
        lease: job.lease_token,
        design: job.design === 'other' ? 'other' : 'own',
        pictures: job.pictures,
        html: link.data.signedUrl,
        etag: job.html_etag
      }
    ],
    skew: false
  }
}

const failureCodes = Object.keys(blueprintFailures) as [
  BlueprintFailure,
  ...BlueprintFailure[]
]

export const uploadResult = z.union([
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    engine: z.string().min(1).max(40),
    blueprint: z.unknown().refine((v) => v !== undefined)
  }),
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    engine: z.string().min(1).max(40),
    failure: z.enum(failureCodes)
  }),
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    retry: z.enum(['timeout', 'unopened', 'html_unreadable'])
  })
])

/**
 * Records one result. Another engine version is handed back (no try
 * counted); a blueprint is checked again for its upload's kind (read from
 * the job itself, never from the report) and refused as failed when it is
 * not valid; a same-version refusal is final.
 */
export async function finishUpload(
  db: Db,
  result: z.infer<typeof uploadResult>
): Promise<{ ok: true; state: string } | { ok: false; code: string }> {
  if ('retry' in result) {
    await fail(db, result.job, result.lease, result.retry)
    return { ok: true, state: 'retry' }
  }
  if (result.engine !== ENGINE_VERSION) {
    const released = await db.rpc('release_email_upload', {
      job: result.job,
      lease: result.lease
    })
    if (released.error)
      return { ok: false, code: released.error.code ?? 'error' }
    return { ok: true, state: 'retry' }
  }
  let blueprint: Blueprint | null = null
  let failure: BlueprintFailure | null = null
  if ('failure' in result) failure = result.failure
  else {
    const job = await db
      .from('platform_jobs')
      .select('subject_key')
      .eq('id', result.job)
      .eq('kind', 'design.upload')
      .maybeSingle()
    if (job.error) return { ok: false, code: job.error.code ?? 'error' }
    const upload = job.data
      ? await db
          .from('email_uploads')
          .select('design,pictures')
          .eq('id', job.data.subject_key)
          .maybeSingle()
      : null
    if (upload?.error) return { ok: false, code: upload.error.code ?? 'error' }
    if (!upload?.data) {
      // Deleted while it was measured: the command finishes the job.
      failure = 'not_valid'
    } else {
      const checked = checkUpload(
        result.blueprint,
        upload.data.design === 'other' ? 'other' : 'own',
        Array.isArray(upload.data.pictures) ? upload.data.pictures.length : 0
      )
      if (checked.ok) blueprint = checked.blueprint
      else failure = checked.failure as BlueprintFailure
    }
  }
  const recorded = await db.rpc('record_email_upload', {
    job: result.job,
    lease: result.lease,
    ...(blueprint
      ? { blueprint: blueprint as unknown as Json }
      : { failure: failure! })
  })
  if (recorded.error?.code === '23514' && blueprint) {
    const again = await db.rpc('record_email_upload', {
      job: result.job,
      lease: result.lease,
      failure: /picture or link/i.test(recorded.error.message ?? '')
        ? 'not_bare'
        : 'not_valid'
    })
    if (again.error) return { ok: false, code: again.error.code ?? 'error' }
    return { ok: true, state: String(again.data) }
  }
  if (recorded.error) return { ok: false, code: recorded.error.code ?? 'error' }
  return { ok: true, state: String(recorded.data) }
}

/** At most this many uploads and leftover folders one sweep removes. */
export const sweepLimits = { uploads: 20, tenants: 10, folders: 100 }

/**
 * The sweep (each run of the measuring job): every `deleting` upload's
 * folder removed, then its row (a `saving` upload left over 30 minutes is
 * made `deleting` first); then, for a few workspaces' folders, any upload
 * folder with no row (a crashed add, a removal that failed, a workspace
 * removed). Counts only.
 */
export async function sweepUploads(
  db: Db,
  random: () => number = Math.random
): Promise<{ removed: number; leftovers: number }> {
  let removed = 0
  let leftovers = 0
  const due = await db.rpc('email_uploads_to_clean', {
    n: sweepLimits.uploads
  })
  if (due.error) throw due.error
  for (const u of (due.data ?? []) as { id: string; folder: string }[])
    if (await removeUpload(db, u.id, u.folder)) removed++
  const bucket = db.storage.from(uploadBucket)
  const tenants = await bucket.list('', { limit: 1000 })
  if (tenants.error) throw tenants.error
  const all = tenants.data.map((t) => t.name).filter((n) => uuid.test(n))
  const start = Math.floor(random() * Math.max(1, all.length))
  const picked = [...all.slice(start), ...all.slice(0, start)].slice(
    0,
    sweepLimits.tenants
  )
  for (const tenant of picked) {
    const folders = await bucket.list(tenant, {
      limit: sweepLimits.folders
    })
    if (folders.error) continue
    const ids = folders.data.map((f) => f.name).filter((n) => uuid.test(n))
    if (!ids.length) continue
    const rows = await db.from('email_uploads').select('id').in('id', ids)
    if (rows.error) continue
    const known = new Set(rows.data.map((r) => r.id))
    for (const id of ids) {
      if (known.has(id)) continue
      const dir = `${tenant}/${id}`
      const files = await bucket.list(dir, { limit: 100 })
      if (files.error || !files.data.length) continue
      const gone = await bucket.remove(
        files.data.map((f) => `${dir}/${f.name}`)
      )
      if (!gone.error) leftovers++
    }
  }
  return { removed, leftovers }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
