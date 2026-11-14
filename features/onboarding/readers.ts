import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { classifyFailure } from '@/features/integrations/failures'
import { runAdsReadingJob } from './ads/live'
import { adsRunMs } from './ads/worker'
import { runReviewsReadingJob } from './reviews/live'
import { reviewsRunMs } from './reviews/worker'
import { runCatalogReadingJob } from './catalog/live'
import { catalogRunMs } from './catalog/worker'
import { runHistoryReadingJob } from './history/live'
import { historyRunMs } from './history/worker'
import {
  dbMarginMs,
  jobFailure,
  readersRunMs,
  runSiteReadingJob,
  siteCallTimeoutMs,
  siteRunMs
} from './site/live'

type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']

/**
 * The longest one source read takes: no page or model call starts without
 * the time it may take, so a read ends by its own limit.
 */
export const sourceRunMs = Math.max(
  siteRunMs,
  catalogRunMs,
  historyRunMs,
  adsRunMs,
  reviewsRunMs
)
export { dbMarginMs, readersRunMs, siteCallTimeoutMs }

export type ReadersRun =
  | { state: 'done'; reads: number; failed: number; paused: number }
  | { state: 'failed'; code: string }

/**
 * One read by its kind: the website (ONB-101), the catalog (ONB-102),
 * what the brand already sent (ONB-103), its live ads (ONB-104) or what
 * customers say (ONB-105).
 */
export async function runSourceReadingJob(
  db: Db,
  job: Job,
  env?: NodeJS.ProcessEnv
): Promise<'read' | 'paused'> {
  if (job.kind === 'brand.read_catalog') {
    const reading = await runCatalogReadingJob(db, job, env)
    return reading.outcome
  }
  if (job.kind === 'brand.read_history') {
    const reading = await runHistoryReadingJob(db, job, env)
    return reading.outcome
  }
  if (job.kind === 'brand.read_ads') {
    await runAdsReadingJob(db, job, env)
    return 'read'
  }
  if (job.kind === 'brand.read_reviews') {
    await runReviewsReadingJob(db, job, env)
    return 'read'
  }
  await runSiteReadingJob(db, job, env)
  return 'read'
}

/**
 * The onboarding readers' run: the source reads waiting across the
 * workspaces (site, catalog, history, ads and reviews), one after another, as the worker. A read
 * is taken only while `readersRunMs` has not passed; each takes at most
 * `sourceRunMs`, so the run ends inside its route's 60 seconds. A read
 * that fails is recorded on its job (tried again later, at most four
 * tries); one Klaviyo paused is put back or stopped by its job; the run
 * goes on. It never throws.
 */
export async function runSourceReadings(
  db: Db,
  options: {
    env?: NodeJS.ProcessEnv
    budgetMs?: number
    now?: () => number
    read?: (db: Db, job: Job) => Promise<'read' | 'paused'>
  } = {}
): Promise<ReadersRun> {
  const now = options.now ?? Date.now
  const started = now()
  const read =
    options.read ?? ((d: Db, j: Job) => runSourceReadingJob(d, j, options.env))
  const run = { state: 'done' as const, reads: 0, failed: 0, paused: 0 }
  try {
    while (now() - started < (options.budgetMs ?? readersRunMs)) {
      const claimed = await db.rpc('claim_source_reading')
      if (claimed.error) throw claimed.error
      const job = (claimed.data as Job[] | null)?.[0]
      if (!job) break
      try {
        if ((await read(db, job)) === 'paused') run.paused++
        else run.reads++
      } catch (error) {
        run.failed++
        const failed = await db.rpc('fail_job', {
          job: job.id,
          lease: job.lease_token!,
          failure: classifyFailure(jobFailure(error))
        })
        if (failed.error)
          logger.warn('Source read failure not recorded', {
            code: failed.error.code ?? 'unknown'
          })
      }
    }
    logger.info('Onboarding readers run finished', run)
    return run
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'readers_run_error'
    logger.error('Onboarding readers run failed', { code })
    return { state: 'failed', code }
  }
}
