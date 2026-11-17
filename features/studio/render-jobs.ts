import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import {
  designedSection,
  sectionDocument,
  sectionProblems,
  type DesignedSection
} from './section'
import { maxSectionBytes } from './renderer'
import { SectionNotDrawable } from './limits'
import { gridBudget, gridProblem, type LumaGrid } from './match'
import { isPicturePath } from './reference'

export { SectionNotDrawable }

/**
 * DST-001b: the render job. The email build's design step asks for a
 * designed section to be drawn (`requestSectionRender`, under its own
 * lease); a browser outside the app (a scheduled GitHub Actions job, as the
 * inbox screenshots) asks for the sections waiting (`renderJobs`), draws
 * each with `scripts/section-render.mjs` loading only the section's own
 * origins, uploads the JPEG through its signed link and reports
 * (`finishRender`). The section is checked again before it is handed out:
 * one that no longer passes is failed, never drawn.
 */

type Db = SupabaseClient<Database>

export const renderLimits = {
  /** Sections handed out per call: the browser asks again for the next. */
  perCall: 1,
  /** Claims a call makes at most to find one section it can hand out. */
  claims: 5,
  /** Origins a section may load from (the command's own limit). */
  maxOrigins: 8,
  /** The section as stored, in bytes of JSON (the command's own limit). */
  maxSectionJson: 100_000
}

/** One section to draw: the page, its height, its origins, where to upload. */
export type RenderJob = {
  job: string
  lease: string
  render: string
  /** The whole page the browser draws (`sectionDocument`). */
  document: string
  /** CSS px at 600 wide; the picture is twice that. */
  height: number
  /** The only origins it may load from. */
  origins: string[]
  /**
   * A signed upload link for render/<render>.jpg. Supabase keeps it
   * valid for 2 hours, for this one path, and it can upload again: the
   * picture's tag is kept when it is recorded (`section_renders.etag`), so
   * a picture changed after that is caught before it is used (DST-006).
   */
  upload: string
  /**
   * DST-004b2b: in Copy mode, a short signed link to the reference
   * section's crop in the Inspiration inbox, for its grid; missing when
   * the render has none or the link could not be made (its match is
   * then not measured).
   */
  reference?: string
}

/**
 * The largest report a browser sends: two grids at the most `gridBudget`
 * allows (48 × 128 cells, at most 4 bytes a value: about 50 kB), with
 * room to spare.
 */
export const maxRenderResultBytes = 120_000

/** How long the reference crop's link is valid: about a job's lease. */
export const referenceLinkSeconds = 180

const hostOf = (origin: string) => new URL(origin).hostname

/**
 * Asks for a checked section to be drawn, under the build's lease on its
 * design step; the same key and section again is the same render, the
 * same key with another section is PT409. A section the format refuses,
 * with no origin or too many, or too large to store, is never queued.
 */
export async function requestSectionRender(
  db: Db,
  input: {
    build: string
    lease: string
    key: string
    section: DesignedSection
    hosts: readonly string[]
    /** DST-004b2b: the inbox section crop it rebuilds (Copy mode). */
    reference?: string
  }
): Promise<string> {
  const hosts = [...new Set(input.hosts)]
  const problems = sectionProblems(input.section, hosts)
  if (!hosts.length || hosts.length > renderLimits.maxOrigins)
    problems.push(`A section loads from 1 to ${renderLimits.maxOrigins} hosts.`)
  if (
    Buffer.byteLength(JSON.stringify(input.section)) >
    renderLimits.maxSectionJson
  )
    problems.push('The section is too large to store.')
  if (problems.length) throw new SectionNotDrawable(problems)
  const { data, error } = await db.rpc('request_section_render', {
    build: input.build,
    lease: input.lease,
    section_key: input.key,
    section: input.section,
    origins: hosts.map((h) => `https://${h}`),
    // Only an inbox section's own crop; anything else is never asked for.
    ...(isPicturePath(input.reference) ? { reference: input.reference } : {})
  })
  if (input.reference !== undefined && !isPicturePath(input.reference))
    logged('A reference path was refused', 'reference_path_refused')
  if (error) throw error
  return data
}

/**
 * Sections waiting to be drawn: due, or leased by a browser that stopped
 * answering (the next claim takes those over).
 */
export async function rendersWaiting(db: Db) {
  const now = new Date().toISOString()
  const { count, error } = await db
    .from('platform_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'studio.render')
    .or(
      `and(status.in.(queued,retry_wait),available_at.lte.${now}),and(status.eq.leased,lease_expires_at.lt.${now})`
    )
  if (error) throw error
  return count ?? 0
}

type Lease = { id: string; lease_token: string; subject_key: string }

const logged = (what: string, code: string | undefined) =>
  logger.error(what, { code: code ?? 'render_job_error' })

/** The job closed as done: its render is gone, so nothing is left to try. */
const settle = async (db: Db, job: string, lease: string, why: string) => {
  const { error } = await db.rpc('finish_platform_job', {
    job,
    lease,
    outcome: { settled: why }
  })
  if (error) logged('A render job could not be finished', error.code)
}

const fail = async (
  db: Db,
  job: string,
  lease: string,
  failure: RenderFailure
) => {
  const { error } = await db.rpc('fail_section_render', { job, lease, failure })
  if (!error) return
  logged('A render could not be failed', error.code)
  // The render went with its build meanwhile: the job is closed, never
  // left to its lease (DST-005b review).
  if (error.code === 'PT409') await settle(db, job, lease, 'gone')
}

/**
 * Claims render jobs until one can be handed out (or none is waiting, or
 * `claims` were made) and signs where it uploads. A render that is gone,
 * already finished, for a build that no longer wants it, or that no longer
 * passes the format, is settled and never handed out.
 */
export async function renderJobs(db: Db): Promise<RenderJob[]> {
  const jobs: RenderJob[] = []
  for (
    let claims = 0;
    claims < renderLimits.claims && jobs.length < renderLimits.perCall;
    claims++
  ) {
    const claimed = await db.rpc('claim_platform_job', {
      kinds: ['studio.render']
    })
    if (claimed.error) throw claimed.error
    const job = (claimed.data as unknown as Lease[] | null)?.[0]
    if (!job) break
    try {
      const handed = await handOut(db, job)
      if (handed) jobs.push(handed)
    } catch (error) {
      logged(
        'A render job could not be handed out',
        (error as { code?: string }).code
      )
      await fail(db, job.id, job.lease_token, 'failed')
    }
  }
  return jobs
}

async function handOut(db: Db, job: Lease): Promise<RenderJob | null> {
  const row = await db
    .from('section_renders')
    .select('id,build_id,section,origins,state,reference_path')
    .eq('id', job.subject_key)
    .maybeSingle()
  if (row.error) {
    // Unreadable now: tried again later.
    const { error } = await db.rpc('fail_platform_job', {
      job: job.id,
      lease: job.lease_token,
      failure: 'unavailable',
      error_code: 'render_read_failed'
    })
    if (error) logged('A render job could not be failed', error.code)
    return null
  }
  if (!row.data) {
    // Gone with its build: nothing to draw, ever (no retries, no ops task).
    await settle(db, job.id, job.lease_token, 'gone')
    return null
  }
  if (row.data.state !== 'queued') {
    // Already drawn or failed: the job has nothing left to do.
    await settle(db, job.id, job.lease_token, row.data.state)
    return null
  }
  const build = await db
    .from('email_builds')
    .select('state')
    .eq('id', row.data.build_id)
    .maybeSingle()
  if (build.error) throw build.error
  if (build.data?.state !== 'build_queued') {
    // The build no longer wants the picture: nothing is drawn.
    await fail(db, job.id, job.lease_token, 'refused')
    return null
  }
  // Checked again: a section that no longer passes is never drawn.
  const section = designedSection.safeParse(row.data.section)
  const origins = row.data.origins
  if (
    !section.success ||
    sectionProblems(section.data, origins.map(hostOf)).length
  ) {
    logged('A section was refused before drawing', 'render_refused')
    await fail(db, job.id, job.lease_token, 'refused')
    return null
  }
  const upload = await db.storage
    .from('studio-renders')
    .createSignedUploadUrl(`render/${row.data.id}.jpg`, { upsert: true })
  if (upload.error || !upload.data) {
    await fail(db, job.id, job.lease_token, 'upload_failed')
    return null
  }
  return {
    job: job.id,
    lease: job.lease_token,
    render: row.data.id,
    document: sectionDocument(section.data),
    height: section.data.height,
    origins,
    upload: upload.data.signedUrl,
    ...(await referenceLink(db, row.data.reference_path))
  }
}

/**
 * The reference crop's short signed link, checked again; none when the
 * render has no reference or the link cannot be made (the section is
 * still drawn; its match is not measured).
 */
async function referenceLink(
  db: Db,
  path: string | null
): Promise<{ reference?: string }> {
  if (!isPicturePath(path)) return {}
  const signed = await db.storage
    .from('inbox-assets')
    .createSignedUrl(path, referenceLinkSeconds)
  if (signed.error || !signed.data?.signedUrl) {
    logged('A reference link could not be made', 'reference_link_failed')
    return {}
  }
  return { reference: signed.data.signedUrl }
}

/** Why a render was not drawn (as the command takes it). */
type RenderFailure =
  'refused' | 'too_large' | 'navigated' | 'timeout' | 'failed' | 'upload_failed'
/** What the browser may report (refusing a section is the server's decision). */
const reported = [
  'too_large',
  'navigated',
  'timeout',
  'failed',
  'upload_failed'
] as const

/**
 * A grey-level grid as the browser makes it (`gridBudget`, whole grey
 * levels, checked whole with `gridProblem`).
 */
export const reportedGrid = z
  .strictObject({
    width: z.int().min(1).max(gridBudget.columns),
    height: z.int().min(1).max(gridBudget.rows),
    values: z
      .array(z.int().min(0).max(255))
      .max(gridBudget.columns * gridBudget.rows)
  })
  .refine((g) => gridProblem(g) === null, 'Not a grid')

/**
 * A grid the report carries: kept only when it is one. Any other value
 * is dropped, never the report: the picture is still recorded, and its
 * match is then not measured.
 */
const grid = z
  .unknown()
  .transform((g) => {
    const ok = reportedGrid.safeParse(g)
    if (!ok.success && g !== undefined)
      logged('A reported grid was dropped', 'grid_dropped')
    return ok.success ? ok.data : undefined
  })
  .optional()

/** What the browser reports for one section: drawn, or why not. */
export const renderResult = z.union([
  z.strictObject({
    job: z.uuid(),
    lease: z.uuid(),
    height: z.int().min(80).max(3200),
    bytes: z.int().min(1).max(maxSectionBytes),
    // DST-004b2b: the drawing's grid and, in Copy mode, its reference's.
    grid,
    referenceGrid: grid
  }),
  z.strictObject({
    job: z.uuid(),
    lease: z.uuid(),
    failure: z.enum(reported)
  })
])
export type RenderResultReport = z.infer<typeof renderResult>

/**
 * Records what the browser reported. PT409: the lease or the render moved
 * on. A drawn report that does not match what is stored (23514) fails
 * the render's attempt instead, so its lease is never left to run out.
 */
export async function finishRender(
  db: Db,
  result: RenderResultReport
): Promise<{ ok: true } | { ok: false; code: string }> {
  if ('failure' in result) {
    const { error } = await db.rpc('fail_section_render', {
      job: result.job,
      lease: result.lease,
      failure: result.failure
    })
    return error
      ? { ok: false, code: error.code ?? 'render_not_recorded' }
      : { ok: true }
  }
  const { error } = await db.rpc('record_section_render', {
    job: result.job,
    lease: result.lease,
    height: result.height,
    bytes: result.bytes,
    ...(result.grid ? { grid: result.grid satisfies LumaGrid } : {}),
    ...(result.referenceGrid
      ? { reference_grid: result.referenceGrid satisfies LumaGrid }
      : {})
  })
  if (!error) return { ok: true }
  if (error.code === '23514') await fail(db, result.job, result.lease, 'failed')
  return { ok: false, code: error.code ?? 'render_not_recorded' }
}
