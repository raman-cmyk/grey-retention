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
import { liveBatchMs } from '@/features/inbox/label'
import { agentAsk, sampleAsk, type Ask } from './passes'

/**
 * How the sweep asks the tagging agents: with no live model set up (the
 * fake, the default), the honest sample rules, and nothing metered or
 * logged; with Gemini set up (D5), MEM-001's runAgent through the metered
 * `runAi` on the platform's daily budget (GEM-003), with the shared memory
 * and the run log, and the pictures sent along.
 */
export function inboxTagging(
  db: SupabaseClient<Database>,
  env: NodeJS.ProcessEnv = process.env
): { ask: Ask; pictures: boolean; batchMs: number } {
  if (aiSetup('label', env).provider === 'fake')
    return { ask: sampleAsk, pictures: false, batchMs: 0 }
  const ledger = new SupabaseBudgetLedger(db)
  return {
    ask: agentAsk({
      ai: (call) => runAi(call, { ledger, env }),
      memory: new SupabaseMemoryStore(db),
      log: new SupabaseRunLog(db)
    }),
    pictures: true,
    batchMs: liveBatchMs
  }
}
