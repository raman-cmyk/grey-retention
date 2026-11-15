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
  perCall: 1
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
  /** A signed upload link for render/<render>.jpg. */
  upload: string
}

const hostOf = (origin: string) => new URL(origin).hostname

/**
 * Asks for a checked section to be drawn, under the build's lease on its
 * design step; the same key again is the same render. A section the format
 * refuses is the caller's mistake: it is never queued.
 */
export async function requestSectionRender(
  db: Db,
  input: {
    build: string
    lease: string
    key: string
    section: DesignedSection
    hosts: readonly string[]
  }
): Promise<string> {
  if (sectionProblems(input.section, input.hosts).length)
    throw new Error('A section the format refuses is never drawn')
  const { data, error } = await db.rpc('request_section_render', {
    build: input.build,
    lease: input.lease,
    section_key: input.key,
    section: input.section,
    origins: [...new Set(input.hosts)].map((h) => `https://${h}`)
  })
  if (error) throw error
  return data as string
}

/** Sections waiting to be drawn (none claimed). */
export async function rendersWaiting(db: Db) {
  const { count, error } = await db
    .from('platform_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'studio.render')
    .in('status', ['queued', 'retry_wait'])
    .lte('available_at', new Date().toISOString())
  if (error) throw error
  return count ?? 0
}

type Lease = { id: string; lease_token: string; subject_key: string }

const fail = async (
  db: Db,
  job: string,
  lease: string,
  failure: RenderFailure
) => {
  const { error } = await db.rpc('fail_section_render', { job, lease, failure })
  if (error)
    logger.error('A render could not be failed', {
      code: error.code ?? 'fail_section_render_error'
    })
}

/** Claims up to `perCall` render jobs and signs where each one uploads. */
export async function renderJobs(db: Db): Promise<RenderJob[]> {
  const jobs: RenderJob[] = []
  for (let i = 0; i < renderLimits.perCall; i++) {
    const claimed = await db.rpc('claim_platform_job', {
      kinds: ['studio.render']
    })
    if (claimed.error) throw claimed.error
    const job = (claimed.data as unknown as Lease[] | null)?.[0]
    if (!job) break
    const row = await db
      .from('section_renders')
      .select('id,section,origins,state')
      .eq('id', job.subject_key)
      .single()
    if (row.error || !row.data || row.data.state !== 'queued') {
      const { error } = await db.rpc('fail_platform_job', {
        job: job.id,
        lease: job.lease_token,
        failure: 'protocol',
        error_code: 'render_missing'
      })
      if (error)
        logger.error('A render job could not be failed', {
          code: error.code ?? 'fail_platform_job_error'
        })
      continue
    }
    // Checked again: a section that no longer passes is never drawn.
    const section = designedSection.safeParse(row.data.section)
    const origins = row.data.origins
    if (
      !section.success ||
      sectionProblems(section.data, origins.map(hostOf)).length
    ) {
      await fail(db, job.id, job.lease_token, 'refused')
      continue
    }
    const upload = await db.storage
      .from('studio-renders')
      .createSignedUploadUrl(`render/${row.data.id}.jpg`, { upsert: true })
    if (upload.error || !upload.data) {
      await fail(db, job.id, job.lease_token, 'upload_failed')
      continue
    }
    jobs.push({
      job: job.id,
      lease: job.lease_token,
      render: row.data.id,
      document: sectionDocument(section.data),
      height: section.data.height,
      origins,
      upload: upload.data.signedUrl
    })
  }
  return jobs
}

const failures = [
  'refused',
  'too_large',
  'navigated',
  'timeout',
  'failed',
  'upload_failed'
] as const
type RenderFailure = (typeof failures)[number]

/** What the browser reports for one section: drawn, or why not. */
export const renderResult = z.union([
  z.strictObject({
    job: z.uuid(),
    lease: z.uuid(),
    height: z.int().min(80).max(3200),
    bytes: z.int().min(1).max(maxSectionBytes)
  }),
  z.strictObject({
    job: z.uuid(),
    lease: z.uuid(),
    failure: z.enum(failures)
  })
])
export type RenderResultReport = z.infer<typeof renderResult>

/** Records what the browser reported; PT409 when the lease or render moved on. */
export async function finishRender(
  db: Db,
  result: RenderResultReport
): Promise<{ ok: true } | { ok: false; code: string }> {
  const { error } =
    'failure' in result
      ? await db.rpc('fail_section_render', {
          job: result.job,
          lease: result.lease,
          failure: result.failure
        })
      : await db.rpc('record_section_render', {
          job: result.job,
          lease: result.lease,
          height: result.height,
          bytes: result.bytes
        })
  if (error) return { ok: false, code: error.code ?? 'render_not_recorded' }
  return { ok: true }
}
