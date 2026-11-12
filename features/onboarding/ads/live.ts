import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { adLibraryFor } from '@/lib/providers/ad-library'
import { cappedEnv, jobFailure, siteAsk, siteCallTimeoutMs } from '../site/live'
import { readBrandAds, type AdsRun } from './worker'

type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']

/**
 * One ads read as the readers' run does it, by the mode it was started in:
 * the sample ads for a synthetic brand, none yet for a real brand (until
 * the owner chooses how the live Ad Library is read); the Ads analyst on
 * the workspace's own budget, every model call capped at
 * `siteCallTimeoutMs`.
 */
export async function runAdsReadingJob(
  db: Db,
  job: Job,
  env: NodeJS.ProcessEnv = process.env
): Promise<AdsRun> {
  const capped = cappedEnv(env)
  try {
    return await readBrandAds(db, job, {
      library: adLibraryFor,
      askFor: siteAsk(db, job.tenant_id, capped),
      callMs: siteCallTimeoutMs
    })
  } catch (error) {
    throw jobFailure(error)
  }
}
