import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'

type Db = SupabaseClient<Database>

export const screenshotLimits = {
  /**
   * Screenshot jobs handed out per call. One: the browser asks again for
   * the next, so no lease waits while another email renders.
   */
  perCall: 1,
  /** How long the signed links in a job work. */
  linkSeconds: 600,
  maxWidth: 2000,
  maxHeight: 16000
}

/**
 * One email to photograph, with signed links only: the HTML to render and
 * each stored image (to put in place of `ref`), valid for 10 minutes, and
 * where to upload the picture (Supabase keeps an upload link valid for 2
 * hours, for this one path). Nothing else may be loaded while rendering.
 */
export type ScreenshotJob = {
  job: string
  lease: string
  html: string
  images: { ref: string; url: string }[]
  upload: string
}

type Lease = { id: string; lease_token: string; subject_key: string }

async function fail(db: Db, job: string, lease: string, code: string) {
  const failed = await db.rpc('fail_platform_job', {
    job,
    lease,
    failure: 'protocol',
    error_code: code
  })
  if (failed.error)
    logger.warn('Screenshot job failure not recorded', {
      code: failed.error.code ?? 'unknown',
      failure: code
    })
}

/** How many screenshots are due now (claims nothing). */
export async function screenshotsWaiting(db: Db) {
  const { count, error } = await db
    .from('platform_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'inbox.screenshot')
    .in('status', ['queued', 'retry_wait'])
    .lte('available_at', new Date().toISOString())
  if (error) throw error
  return count ?? 0
}

/** Claims up to `perCall` screenshot jobs and signs what each one needs. */
export async function screenshotJobs(db: Db): Promise<ScreenshotJob[]> {
  const jobs: ScreenshotJob[] = []
  for (let i = 0; i < screenshotLimits.perCall; i++) {
    const claimed = await db.rpc('claim_platform_job', {
      kinds: ['inbox.screenshot']
    })
    if (claimed.error) throw claimed.error
    const job = (claimed.data as unknown as Lease[] | null)?.[0]
    if (!job) break
    const message = await db
      .from('inbox_messages')
      .select('id,html_path')
      .eq('id', job.subject_key)
      .single()
    const images = await db
      .from('inbox_message_images')
      .select('source_ref,path')
      .eq('inbox_message_id', job.subject_key)
      .eq('state', 'stored')
      .in('source', ['remote', 'cid'])
    if (message.error || !message.data?.html_path || images.error) {
      await fail(db, job.id, job.lease_token, 'inbox_message_missing')
      continue
    }
    const raw = db.storage.from('inbox-raw')
    const assets = db.storage.from('inbox-assets')
    const [html, signed, upload] = await Promise.all([
      raw.createSignedUrl(message.data.html_path, screenshotLimits.linkSeconds),
      images.data.length
        ? assets.createSignedUrls(
            [...new Set(images.data.map((r) => r.path!))],
            screenshotLimits.linkSeconds
          )
        : Promise.resolve({ data: [], error: null }),
      assets.createSignedUploadUrl(`shot/${job.subject_key}.jpg`, {
        upsert: true
      })
    ])
    if (
      html.error ||
      signed.error ||
      upload.error ||
      !html.data ||
      !upload.data
    ) {
      await fail(db, job.id, job.lease_token, 'screenshot_links_failed')
      continue
    }
    const urlByPath = new Map(
      (signed.data ?? []).map((s) => [s.path ?? '', s.signedUrl])
    )
    jobs.push({
      job: job.id,
      lease: job.lease_token,
      html: html.data.signedUrl,
      images: images.data.flatMap((r) => {
        const url = urlByPath.get(r.path ?? '')
        return url ? [{ ref: r.source_ref, url }] : []
      }),
      upload: upload.data.signedUrl
    })
  }
  return jobs
}

export const screenshotResult = z.union([
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    width: z.number().int().min(1).max(screenshotLimits.maxWidth),
    height: z.number().int().min(1).max(screenshotLimits.maxHeight)
  }),
  z.object({
    job: z.uuid(),
    lease: z.uuid(),
    failure: z.enum(['render_failed', 'upload_failed', 'html_unreadable'])
  })
])

/**
 * Records one screenshot the browser uploaded (or why it could not), and
 * finishes the job. A retry overwrites the same picture: never two.
 */
export async function finishScreenshot(
  db: Db,
  result: z.infer<typeof screenshotResult>
): Promise<{ ok: true } | { ok: false; code: string }> {
  const lease = { job: result.job, lease: result.lease }
  if ('failure' in result) {
    await fail(db, result.job, result.lease, result.failure)
    return { ok: true }
  }
  const recorded = await db.rpc('record_inbox_screenshot', {
    ...lease,
    width: result.width,
    height: result.height
  })
  if (recorded.error) return { ok: false, code: recorded.error.code ?? 'error' }
  const finished = await db.rpc('finish_platform_job', {
    ...lease,
    outcome: { width: result.width, height: result.height }
  })
  if (finished.error) return { ok: false, code: finished.error.code ?? 'error' }
  return { ok: true }
}
