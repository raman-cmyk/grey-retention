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
import { databaseFallbackLog } from '@/features/fallback/log'
import { logger } from '@/lib/logger'
import {
  codePulse,
  gatherEvidence,
  offerPick,
  offersToPlan,
  readPulseInput,
  runBrandPulse,
  type Pulse
} from './pulse'
import {
  codeMoves,
  mapPatterns,
  readMapperInput,
  runCompetitorMapper
} from './competitors'
import { planFifteenDays, samplePlan } from './plan'
import { sampleStrategyData, type StrategyData } from './data'

type Db = SupabaseClient<Database>

/** Steps one call runs at most (a cron request or an owner's click). */
export const stepsPerCall = 2

/**
 * Runs waiting "Plan next 15 days" steps (STR-003 part 2). Each step is
 * claimed with a lease (`claim_strategy_run`), so overlapping calls never
 * run one step twice; a step that throws is failed with a short code and
 * tried again by the next call, at most 3 times.
 *
 * With no live model set up (the fake, the default), the honest sample
 * path: the code-only pulse, moves and plan, no agent call and nothing
 * metered or logged as a fallback. With Gemini set up (D5), MEM-001's
 * agents through the metered `runAi`, with the shared memory, the run log
 * and the fallback log (D16). Needs the service-role client.
 */
export async function runStrategyRuns(
  db: Db,
  deps: {
    data?: StrategyData
    env?: NodeJS.ProcessEnv
    limit?: number
  } = {}
) {
  const data = deps.data ?? sampleStrategyData
  const env = deps.env ?? process.env
  const live = aiSetup('plan', env).provider !== 'fake'
  const agents = live
    ? (() => {
        const ledger = new SupabaseBudgetLedger(db)
        return {
          ai: (call: Parameters<typeof runAi>[0]) =>
            runAi(call, { ledger, env }),
          memory: new SupabaseMemoryStore(db),
          log: new SupabaseRunLog(db),
          fallbacks: databaseFallbackLog(db)
        }
      })()
    : null
  let ran = 0
  for (let n = 0; n < (deps.limit ?? stepsPerCall); n++) {
    const claimed = await db.rpc('claim_strategy_run')
    if (claimed.error) throw claimed.error
    const run = claimed.data?.[0]
    if (!run) break
    try {
      const store = await data.load({
        tenantId: run.tenant_id,
        start: run.start_on
      })
      const ctx = agents && {
        ...agents,
        tenantId: run.tenant_id,
        callerKey: `plan:${run.id}`
      }
      if (run.state === 'pulse_queued') {
        const { input } = readPulseInput(store.pulse)
        if (input.start !== run.start_on)
          throw Object.assign(new Error('Store data for other days'), {
            code: 'store_wrong_days'
          })
        const pulse = ctx
          ? (await runBrandPulse(input, ctx)).pulse
          : codePulse(gatherEvidence(input))
        const done = await db.rpc('finish_strategy_pulse', {
          run: run.id,
          lease: run.lease_token,
          result: pulse as never
        })
        if (done.error) throw done.error
      } else {
        const pulse = run.pulse as unknown as Pulse
        const offers = offersToPlan(pulse, offerPick.parse(run.offer_pick))
        if (!offers.ok)
          throw Object.assign(new Error('Pick not in the pulse'), {
            code: 'pick_not_in_pulse'
          })
        const mapper = readMapperInput(store.mapper)
        const moves = ctx
          ? (await runCompetitorMapper(mapper, ctx)).moves
          : codeMoves(mapPatterns(mapper))
        const input = {
          ...store.plan,
          start: run.start_on,
          pulse,
          offers: offers.offers,
          moves
        }
        const plan = ctx ? await planFifteenDays(input, ctx) : samplePlan(input)
        const done = await db.rpc('finish_strategy_plan', {
          run: run.id,
          lease: run.lease_token,
          result: plan as never
        })
        if (done.error) throw done.error
      }
      ran++
    } catch (error) {
      const code = stepCode(error)
      logger.error('Plan step failed', { run: run.id, code })
      await db.rpc('fail_strategy_step', {
        run: run.id,
        lease: run.lease_token,
        code
      })
    }
  }
  return { ran }
}

/** A short, safe error code for the run (never a message or a payload). */
export function stepCode(error: unknown) {
  const code = (error as { code?: unknown })?.code
  if (typeof code === 'string' && /^[a-z][a-z0-9_]{1,59}$/.test(code))
    return code
  if ((error as { name?: string })?.name === 'ZodError')
    return 'store_data_invalid'
  return 'step_error'
}
