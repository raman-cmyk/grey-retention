import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import {
  SupabaseMemoryStore,
  SupabaseRunLog
} from '@/features/agents/supabase-stores'
import { SupabaseBudgetLedger } from '@/features/ai/budget-ledger'
import { runAi } from '@/features/ai/run'
import { aiSetup, cappedAiEnv } from '@/features/ai/setup'
import type { BuildAgents } from './build'
import { agentCallMs } from './step-names'

/**
 * REL-AI part 2: "Create email" on the agent path. Each model call is
 * capped at `agentCallMs` (15 s), so a step with its 3 tries (about 46 to
 * 48 s at worst, with its database calls) stays inside the 50-second step
 * budget (`stepBudgetMs`); the job starts an agent step only while a whole
 * step fits before its deadline, and a step with rounds saves them when
 * the next call would not fit (part 2b).
 */
export { agentCallMs }

/** The environment of a build step: every model call capped. */
export function agentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return cappedAiEnv('copy', env, agentCallMs)
}

/**
 * The owner's switch for the agents in "Create email": off unless
 * `EMAIL_BUILD_AGENTS=on`. A Gemini key alone (D5, already used by the
 * readers) never turns them on, so merging this changes nothing and no
 * build spends paid AI until the owner says so.
 */
export const emailAgentsOn = (env: NodeJS.ProcessEnv) =>
  env.EMAIL_BUILD_AGENTS?.trim() === 'on'

/**
 * The build's agents, or null for the code-only path: when the switch is
 * off, or no live model is set up (the fake), the build stays on the code
 * path and nothing is metered or logged, as the inbox and onboarding
 * readers do without a model. With both on, MEM-001's agents run through
 * the metered `runAi`, charged to the workspace's own AI allowance
 * (`reserve_ai_usage`), with the shared do's and don'ts and the run log.
 */
export function buildAgentsFor(
  db: SupabaseClient<Database>,
  env: NodeJS.ProcessEnv = process.env
): BuildAgents | null {
  const setup = aiSetup('copy', env)
  if (!emailAgentsOn(env) || setup.provider === 'fake' || !setup.ready)
    return null
  const capped = agentEnv(env)
  const ledger = new SupabaseBudgetLedger(db)
  return {
    memory: new SupabaseMemoryStore(db),
    log: new SupabaseRunLog(db),
    ai: (call) => runAi(call, { ledger, env: capped })
  }
}
