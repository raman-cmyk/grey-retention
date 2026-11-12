import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { ProviderFault } from '@/features/integrations/failures'
import { KlaviyoError } from '@/lib/providers/klaviyo/client'
import { recordedHistoryTransport } from '@/lib/providers/klaviyo/recorded-history'
import {
  catalogSourceFor,
  pauseOnKlaviyo,
  type PauseReason
} from '../catalog/live'
import { cappedEnv, jobFailure, siteAsk, siteCallTimeoutMs } from '../site/live'
import { readBrandHistory, type HistoryRun } from './worker'

type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']

export type HistoryReading =
  | ({ outcome: 'read' } & HistoryRun)
  | { outcome: 'paused'; reason: PauseReason }

/**
 * One history read as the readers' run does it, on the same terms as a
 * catalog read: the live account only with `KLAVIYO_MODE=live` and its
 * stored key, the recorded sample account only for a synthetic brand,
 * every Klaviyo request capped and no rate limit waited out; Klaviyo's
 * pace, a refused key or a missing scope pause the job.
 */
export async function runHistoryReadingJob(
  db: Db,
  job: Job,
  env: NodeJS.ProcessEnv = process.env
): Promise<HistoryReading> {
  const capped = cappedEnv(env)
  const source = await catalogSourceFor(db, job, capped, () =>
    recordedHistoryTransport()
  )
  if ('reason' in source) {
    logger.warn('History read not started', { reason: source.reason })
    throw new ProviderFault('validation')
  }
  try {
    const run = await readBrandHistory(db, job, {
      client: source.client,
      live: source.live,
      ask: siteAsk(db, job.tenant_id, capped)(source.live),
      callMs: siteCallTimeoutMs
    })
    return { outcome: 'read', ...run }
  } catch (error) {
    if (!(error instanceof KlaviyoError)) throw jobFailure(error)
    return pauseOnKlaviyo(db, job, error, 'History read')
  }
}
