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
import { agentAsk, sampleAsk } from '@/features/intelligence/passes'
import { siteFetcherFor } from './fetch'
import { readBrandSite, type SiteRun } from './worker'

type Job = Database['public']['Tables']['job_runs']['Row']

/**
 * The Site reader's job as the workspace jobs run it: the sample site and
 * the sample rules by default; Gemini (D5, on the workspace's own budget)
 * when it is set up; the live website only with `SITE_READER_MODE=live`.
 */
export function runSiteReadingJob(
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
  return readBrandSite(db, job, {
    fetcher: (domain) => siteFetcherFor(domain, env),
    ask
  })
}
