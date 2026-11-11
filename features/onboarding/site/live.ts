import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import {
  SupabaseMemoryStore,
  SupabaseRunLog
} from '@/features/agents/supabase-stores'
import { SupabaseBudgetLedger } from '@/features/ai/budget-ledger'
import { runAi } from '@/features/ai/run'
import { aiSetup } from '@/features/ai/setup'
import { ProviderFault } from '@/features/integrations/failures'
import {
  agentAsk,
  sampleAsk,
  TagError,
  type Ask
} from '@/features/intelligence/passes'
import { siteFetcherFor } from './fetch'
import { readBrandSite, siteRunMs, type SiteRun } from './worker'

type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']

/** The longest one Site reader call may take in the readers' run. */
export const siteCallTimeoutMs = 10_000
/** No new site read starts after this long into the readers' run. */
export const readersRunMs = 15_000
/**
 * Time kept for the database work around a read (claiming it, reading the
 * brand, storing its findings), on top of the read's own limit.
 */
export const dbMarginMs = 4_000

/**
 * An AI failure as the job runner classifies it: an outage or a rate limit
 * is tried again (a few seconds later, at most four tries); a spent budget
 * or a refused request stops, and the owner can start the read again.
 */
export function jobFailure(error: unknown): unknown {
  if (!(error instanceof TagError)) return error
  return new ProviderFault(
    error.code === 'rate_limited'
      ? 'rate_limit'
      : error.retryable
        ? 'transient'
        : 'validation'
  )
}

/**
 * The environment of the readers' run: every model call capped. The
 * timeout the AI setup really uses (it ignores a value it cannot take and
 * uses its default) is read back, so the cap always holds.
 */
export function cappedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const setup = aiSetup('review', env)
  const used = 'timeoutMs' in setup ? setup.timeoutMs : siteCallTimeoutMs
  return {
    ...env,
    GEMINI_TIMEOUT_MS: String(Math.min(used, siteCallTimeoutMs))
  } as NodeJS.ProcessEnv
}

/**
 * How the Site reader is asked: the sample rules for the sample site
 * (never a paid call for sample pages); Gemini for a live site when it is
 * set up (D5, on the workspace's own budget); otherwise no one, and a live
 * site is not read.
 */
export function siteAsk(
  db: Db,
  tenantId: string,
  env: NodeJS.ProcessEnv
): (live: boolean) => Ask | null {
  const modelSetUp = aiSetup('review', env).provider !== 'fake'
  return (live) =>
    !live
      ? sampleAsk
      : modelSetUp
        ? agentAsk({
            ai: (call) =>
              runAi(call, { ledger: new SupabaseBudgetLedger(db), env }),
            memory: new SupabaseMemoryStore(db),
            log: new SupabaseRunLog(db),
            tenantId
          })
        : null
}

/**
 * One site read as the readers' run does it: the sample site by default;
 * the live website only with `SITE_READER_MODE=live`; every model call
 * capped at `siteCallTimeoutMs`.
 */
export async function runSiteReadingJob(
  db: Db,
  job: Job,
  env: NodeJS.ProcessEnv = process.env
): Promise<SiteRun> {
  const capped = cappedEnv(env)
  try {
    return await readBrandSite(db, job, {
      fetcher: (domain) => siteFetcherFor(domain, capped),
      askFor: siteAsk(db, job.tenant_id, capped),
      callMs: siteCallTimeoutMs
    })
  } catch (error) {
    throw jobFailure(error)
  }
}

export { siteRunMs }
