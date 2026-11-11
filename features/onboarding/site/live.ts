import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import {
  SupabaseMemoryStore,
  SupabaseRunLog
} from '@/features/agents/supabase-stores'
import { SupabaseBudgetLedger } from '@/features/ai/budget-ledger'
import { runAi } from '@/features/ai/run'
import { aiSetup } from '@/features/ai/setup'
import {
  classifyFailure,
  ProviderFault
} from '@/features/integrations/failures'
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

/** The environment of the readers' run: every model call capped. */
export function cappedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const configured = Number(env.GEMINI_TIMEOUT_MS)
  return {
    ...env,
    GEMINI_TIMEOUT_MS: String(
      Number.isFinite(configured) && configured > 0
        ? Math.min(configured, siteCallTimeoutMs)
        : siteCallTimeoutMs
    )
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

export type ReadersRun =
  | { state: 'done'; reads: number; failed: number }
  | { state: 'failed'; code: string }

/**
 * The onboarding readers' run (ONB-101): the site reads waiting across the
 * workspaces, one after another, as the worker. A read is taken only while
 * `readersRunMs` has not passed; each takes at most `siteRunMs` plus one
 * capped call, so the run ends inside its route's 60 seconds. A read that
 * fails is recorded on its job (tried again later, at most four tries);
 * the run goes on. It never throws.
 */
export async function runSiteReadings(
  db: Db,
  options: {
    env?: NodeJS.ProcessEnv
    budgetMs?: number
    now?: () => number
    read?: (db: Db, job: Job) => Promise<unknown>
  } = {}
): Promise<ReadersRun> {
  const now = options.now ?? Date.now
  const started = now()
  const read =
    options.read ?? ((d: Db, j: Job) => runSiteReadingJob(d, j, options.env))
  const run = { state: 'done' as const, reads: 0, failed: 0 }
  try {
    while (now() - started < (options.budgetMs ?? readersRunMs)) {
      const claimed = await db.rpc('claim_site_reading')
      if (claimed.error) throw claimed.error
      const job = (claimed.data as Job[] | null)?.[0]
      if (!job) break
      try {
        await read(db, job)
        run.reads++
      } catch (error) {
        run.failed++
        const failed = await db.rpc('fail_job', {
          job: job.id,
          lease: job.lease_token!,
          failure: classifyFailure(jobFailure(error))
        })
        if (failed.error)
          logger.warn('Site read failure not recorded', {
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

export { siteRunMs }
