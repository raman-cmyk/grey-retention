import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import {
  codePulse,
  gatherEvidence,
  offerPick,
  offersToPlan,
  readPulseInput
} from './pulse'
import { codeMoves, mapPatterns, readMapperInput } from './competitors'
import { samplePlan } from './plan'
import { sampleStrategyData, type StrategyData } from './data'
import { storedPulse } from './stored'
import { SupabaseOfferSource } from '@/features/offers/source'
import type { SavedOffers } from '@/features/email-build/ports'
import {
  offerWorksAt,
  planOfferSource,
  pulseCodes,
  readPlanOffers,
  stillUsable,
  workspaceTimezone
} from './offers'

type Db = SupabaseClient<Database>

/**
 * Runs waiting "Plan next 15 days" steps (STR-003 part 2). Each step is
 * claimed with a lease (`claim_strategy_run`), so overlapping calls never
 * run one step twice; a step that throws is failed with a short code and
 * tried again a minute later, at most 3 times, or at once for good when a
 * retry cannot help.
 *
 * While the store data is the sample store (no reader yet), every step is
 * the code-only path: the pulse, competitor moves and plan from code, with
 * no AI call, nothing metered and nothing logged as a fallback. It is fast
 * and bounded, so the cron sweep and the owner's click can both run it.
 * The agents (STR-001..003, built on MEM-001's runAgent) are wired in here
 * together with the first real store reader, with their own time limit and
 * a lease long enough for paid steps.
 *
 * Offers (#379) come from what the owner saved in Settings, by the same
 * rule as "Create email" (`features/strategy/offers.ts`), in the
 * workspace's one timezone: the offer step lists them, and the plan step
 * keeps only picked offers that still work and checks every offer email at
 * its own send time.
 */
export async function runStrategyRuns(
  db: Db,
  deps: {
    data?: StrategyData
    /** Default: DSC-001's `SupabaseOfferSource` on `db` (service role). */
    saved?: SavedOffers
    /** Run only this plan (the owner's click), once. */
    run?: string
    /** Steps to run at most. */
    limit?: number
    /** Stop claiming after this time (ms since epoch). */
    deadline?: number
    now?: () => number
  } = {}
) {
  const data = deps.data ?? sampleStrategyData
  const saved = deps.saved ?? new SupabaseOfferSource(db)
  const now = deps.now ?? Date.now
  const limit = deps.run ? 1 : (deps.limit ?? 2)
  let ran = 0
  for (let n = 0; n < limit; n++) {
    if (deps.deadline && now() > deps.deadline) break
    const claimed = await db.rpc(
      'claim_strategy_run',
      deps.run ? { target: deps.run } : {}
    )
    if (claimed.error) throw claimed.error
    const run = claimed.data?.[0]
    if (!run) break
    try {
      const store = await data.load({
        tenantId: run.tenant_id,
        start: run.start_on
      })
      const timezone = await workspaceTimezone(db, run.tenant_id)
      const offers = await readPlanOffers(
        planOfferSource(saved, run.start_on),
        run.tenant_id,
        run.start_on,
        timezone
      )
      if (run.state === 'pulse_queued') {
        const { input } = readPulseInput(store.pulse)
        if (input.start !== run.start_on) throw final('store_wrong_days')
        // The owner's offers (or the sample's when nothing is saved), never
        // the store data's own codes.
        const pulse = codePulse(
          gatherEvidence({
            ...input,
            brand: {
              ...input.brand,
              maxDiscountPercent: offers.maxDiscountPercent
            },
            codes: pulseCodes(offers, run.start_on, timezone)
          })
        )
        const done = await db.rpc('finish_strategy_pulse', {
          run: run.id,
          lease: run.lease_token,
          result: { ...pulse, sample: store.sample } as never
        })
        if (done.error) throw done.error
      } else {
        const stored = storedPulse.safeParse(run.pulse)
        if (!stored.success || stored.data.start !== run.start_on)
          throw final('stored_pulse_invalid')
        const pick = offerPick.safeParse(run.offer_pick)
        if (!pick.success) throw final('stored_pick_invalid')
        const picked = offersToPlan(stored.data, pick.data)
        if (!picked.ok) throw final('pick_not_in_pulse')
        const mapper = readMapperInput(store.mapper)
        if (mapper.start !== run.start_on) throw final('store_wrong_days')
        // Settings may have changed since the offer step: only picked offers
        // that still work, with their current percent and last full day.
        const { usable, leftOut } = stillUsable(
          picked.offers,
          offers,
          run.start_on,
          timezone
        )
        const ids = new Set(usable.map((o) => o.id))
        const pulse = {
          ...stored.data,
          offers: usable,
          highlights: stored.data.highlights.filter(
            (h) => h.kind !== 'offer' || ids.has(h.id)
          )
        }
        const made = samplePlan({
          ...store.plan,
          start: run.start_on,
          pulse,
          offers: usable,
          moves: codeMoves(mapPatterns(mapper))
        })
        // Every offer email works at its own send time, as "Create email"
        // will check it (a guard: the plan's last full days ensure it).
        if (made.slots.some((s) => !offerWorksAt(s, offers, timezone)))
          throw final('plan_offer_unusable')
        const plan = {
          ...made,
          notes: [
            ...leftOut.map(
              (code) =>
                `${code} was left out: it changed in your Settings after you picked it.`
            ),
            ...made.notes
          ]
        }
        const done = await db.rpc('finish_strategy_plan', {
          run: run.id,
          lease: run.lease_token,
          result: { ...plan, sample: store.sample } as never
        })
        if (done.error) throw done.error
      }
      ran++
    } catch (error) {
      const code = stepCode(error)
      const isFinal =
        (error as { final?: boolean })?.final === true ||
        code === 'store_data_invalid'
      logger.error('Plan step failed', { run: run.id, code })
      await db.rpc('fail_strategy_step', {
        run: run.id,
        lease: run.lease_token,
        code,
        final: isFinal
      })
    }
  }
  return { ran }
}

/** A failure a retry cannot fix (bad stored or store data). */
function final(code: string) {
  return Object.assign(new Error(code), { code, final: true })
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
