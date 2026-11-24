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
import { klaviyoMode } from '@/features/connections/live-klaviyo'
import type { AgentCtx } from './retry'

export type StrategyAgents = Pick<AgentCtx, 'memory' | 'log' | 'ai'>

/** The Plan action has 120 seconds; leave time for store reads and saves. */
export const strategyBudgetMs = 100_000
/**
 * Each provider call, not a whole critic/rewrite loop. The plan model
 * (3.8 Flash, AI-MDL-001) thinks before it answers: the first live run had
 * 3.x calls past 15 s, so a call gets 25 s, as the Brand strategist's
 * (`strategistCallMs`). A call cut off by its time limit is still charged.
 */
export const strategyCallMs = 25_000
/** Reserve time for metering, memory and the final database save. */
export const strategySlackMs = 5_000

/** Paid planning is a separate owner-controlled server switch, off by default. */
export const strategyAgentsOn = (env: NodeJS.ProcessEnv) =>
  env.STRATEGY_AGENTS === 'on'

/** Uses the same metered provider gateway and memory as the email agents. */
export function strategyAgentsFor(
  db: SupabaseClient<Database>,
  env: NodeJS.ProcessEnv = process.env
): StrategyAgents | null {
  if (!strategyAgentsOn(env)) return null
  // Sample Klaviyo data never spends paid AI (it reads as the store's own).
  if (klaviyoMode(env) !== 'live') return null
  for (const purpose of ['plan', 'review'] as const) {
    const setup = aiSetup(purpose, env)
    if (!setup.ready || setup.provider === 'fake') return null
  }
  const ledger = new SupabaseBudgetLedger(db)
  return {
    memory: new SupabaseMemoryStore(db),
    log: new SupabaseRunLog(db),
    ai: (input) =>
      runAi(input, {
        ledger,
        env: cappedAiEnv(input.purpose, env, strategyCallMs)
      })
  }
}

/** Refuse another call before spending if it cannot fit in this claim. */
export function boundedStrategyAgents(
  agents: StrategyAgents,
  until: number,
  now: () => number
): StrategyAgents & Pick<AgentCtx, 'fits'> {
  const fits = () => now() + strategyCallMs + strategySlackMs < until
  return {
    ...agents,
    fits,
    ai: (input) =>
      fits()
        ? agents.ai(input)
        : Promise.resolve({ ok: false, code: 'unavailable' })
  }
}
