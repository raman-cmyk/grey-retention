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
import { agentAsk, sampleAsk, TagError } from '@/features/intelligence/passes'
import { siteFetcherFor } from './fetch'
import { readBrandSite, type SiteRun } from './worker'

type Job = Database['public']['Tables']['job_runs']['Row']

/**
 * An AI failure as the workspace jobs classify it: a rate limit or a spent
 * budget waits longer, an outage is tried again, anything else stops (the
 * job's four tries are the limit either way).
 */
export function jobFailure(error: unknown): unknown {
  if (!(error instanceof TagError)) return error
  return new ProviderFault(
    error.code === 'rate_limited' || error.code === 'cap_reached'
      ? 'rate_limit'
      : error.retryable
        ? 'transient'
        : 'validation'
  )
}

/**
 * The Site reader's job as the workspace jobs run it: the sample site and
 * the sample rules by default; Gemini (D5, on the workspace's own budget)
 * when it is set up; the live website only with `SITE_READER_MODE=live`.
 */
export async function runSiteReadingJob(
  db: SupabaseClient<Database>,
  job: Job,
  env: NodeJS.ProcessEnv = process.env
): Promise<SiteRun> {
  const ask =
    aiSetup('review', env).provider === 'fake'
      ? sampleAsk
      : agentAsk({
          ai: (call) =>
            runAi(call, { ledger: new SupabaseBudgetLedger(db), env }),
          memory: new SupabaseMemoryStore(db),
          log: new SupabaseRunLog(db),
          tenantId: job.tenant_id
        })
  try {
    return await readBrandSite(db, job, {
      fetcher: (domain) => siteFetcherFor(domain, env),
      ask
    })
  } catch (error) {
    throw jobFailure(error)
  }
}
