import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { socialSourceFor } from '@/lib/providers/review-source'
import { cappedEnv, jobFailure, siteAsk, siteCallTimeoutMs } from '../site/live'
import { reviewSourceFor } from './source'
import { readBrandReviews, type ReviewsRun } from './worker'

type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']

/**
 * One reviews read as the readers' run does it, by the mode it was started
 * in: the samples for a synthetic brand; for a real brand the reviews on
 * its own product pages only with `SITE_READER_MODE=live` (the site
 * reader's limits), and no social comments yet (until the owner chooses
 * how public profiles are read); the reader on the workspace's own budget,
 * every model call capped at `siteCallTimeoutMs`.
 */
export async function runReviewsReadingJob(
  db: Db,
  job: Job,
  env: NodeJS.ProcessEnv = process.env
): Promise<ReviewsRun> {
  const capped = cappedEnv(env)
  try {
    return await readBrandReviews(db, job, {
      reviews: (mode, domain, urls, time) =>
        reviewSourceFor(mode, domain, urls, time, env),
      social: socialSourceFor,
      askFor: siteAsk(db, job.tenant_id, capped),
      callMs: siteCallTimeoutMs
    })
  } catch (error) {
    throw jobFailure(error)
  }
}
