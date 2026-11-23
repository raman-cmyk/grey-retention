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
import type { AgentCtx } from './retry'

export type StrategyAgents = Pick<AgentCtx, 'memory' | 'log' | 'ai'>

/** The Plan action has 120 seconds; leave time for store reads and saves. */
export const strategyBudgetMs = 100_000
/** Each provider call, not a whole critic/rewrite loop. */
export const strategyCallMs = 10_000
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
