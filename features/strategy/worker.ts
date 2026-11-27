import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import {
  codePulse,
  gatherEvidence,
  offerFact,
  offerPick,
  offersToPlan,
  readPulseInput,
  runBrandPulse
} from './pulse'
import {
  codeMoves,
  mapPatterns,
  readMapperInput,
  runCompetitorMapper
} from './competitors'
import {
  goalLines,
  readGuidance,
  planFifteenDays,
  samplePlan,
  unusedOffersNote,
  type PlanGuidance
} from './plan'
import { planGuidance } from './guidance'
import { sampleStrategyData, type StrategyData } from './data'
import { storedPulse } from './stored'
import { SupabaseOfferSource } from '@/features/offers/source'
import type { SavedOffers } from '@/features/email-build/ports'
import {
  droppedOffersEntry,
  droppedOffersNote,
  leftOutNote,
  planOfferSource,
  pulseCodes,
  readPlanOffers,
  stillUsable,
  withoutUnusableOffers,
  workspaceTimezone,
  type PlanOffers
} from './offers'
import { databaseFallbackLog, type FallbackLog } from '@/features/fallback/log'
import { outsideWindowEntry, outsideWindowNote, slotsInWindow } from './dates'
import { keyPart } from '@/features/fallback/entry'
import { planCode, type PlanFailureCode } from './failure-words'
import {
  boundedStrategyAgents,
  strategyBudgetMs,
  type StrategyAgents
} from './agents'

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
 * The owner action can supply metered STR-001..003 agents, behind the
 * separate STRATEGY_AGENTS switch. Only a real own-store read uses them;
 * calls have a deadline and failures use the existing logged fallback.
 * The ordinary sweep never supplies agents and remains code-only.
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
    /** Default: the database fallback log (`agent_fallbacks`). */
    fallbacks?: FallbackLog
    /** Owner action only. Cron and sample stores stay code-only by default. */
    agents?: StrategyAgents | null
    /** Run only this plan (the owner's click), once. */
    run?: string
    /** Steps to run at most. */
    limit?: number
    /** Stop claiming after this time (ms since epoch). */
    deadline?: number
    now?: () => number
    /**
     * PICK-WIRE (#33, #37, #48, #49): the plan's goal, mix and competitor
     * facts. Default: read from `db` for the run's workspace
     * (`planGuidance`); it never throws, and a part it cannot read is left
     * out.
     */
    guidance?: (input: {
      tenantId: string
      start: string
      timezone: string
      sendsPerWeek: number
      offers: number
      now: number
    }) => Promise<PlanGuidance>
  } = {}
) {
  const data = deps.data ?? sampleStrategyData
  const guidanceOf = deps.guidance ?? ((input) => planGuidance(db, input))
  const saved = deps.saved ?? new SupabaseOfferSource(db)
  const fallbacks =
    deps.fallbacks ??
    databaseFallbackLog(db, (lost) =>
      logger.warn('Fallback could not be recorded', lost)
    )
  const now = deps.now ?? Date.now
  const until = Math.min(deps.deadline ?? Infinity, now() + strategyBudgetMs)
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
      // Never charge AI for a demo/fallback store, or from the ordinary
      // scheduled sweep, which does not supply agents. Identity is always
      // the leased row's tenant, never a browser-supplied model argument.
      const agentCtx =
        deps.agents && store.own === true && !store.sample
          ? {
              ...boundedStrategyAgents(deps.agents, until, now),
              tenantId: run.tenant_id,
              callerKey: `strategy:${keyPart(run.id)}:${run.state}`,
              now: new Date(now()).toISOString(),
              fallbacks
            }
          : null
      const timezone = await workspaceTimezone(db, run.tenant_id)
      let offers: PlanOffers
      let unreadable = false
      try {
        offers = await readPlanOffers(
          planOfferSource(saved, run.start_on, { sample: store.sample }),
          run.tenant_id,
          run.start_on,
          timezone
        )
      } catch (error) {
        // A failed read is tried again within the step's normal attempts;
        // on the last one the plan goes on with no offers, so it is never
        // stuck, and the fallback log says so (supervisor, 11 Nov).
        if (
          stepCode(error) !== 'offers_unreadable' ||
          (await attemptsOf(db, run.id)) < planStepTries
        )
          throw error
        offers = { maxDiscountPercent: 0, codes: [] }
        unreadable = true
        await fallbacks.record({
          tenantId: run.tenant_id,
          campaignId: null,
          agent: 'plan-offers',
          reasonCode: 'offers_unreadable',
          reason: `The saved offers could not be read after ${planStepTries} tries.`,
          fallback:
            run.state === 'pulse_queued'
              ? 'Listed no offers for these 15 days.'
              : 'Planned these 15 days with no offers.',
          attempts: planStepTries,
          detail: { step: run.state },
          dedupeKey: `plan-offers:${keyPart(run.id)}:${run.state}`
        })
      }
      if (run.state === 'pulse_queued') {
        const { input } = readPulseInput(store.pulse)
        if (input.start !== run.start_on) throw final('store_wrong_days')
        // The owner's offers (or the sample's when nothing is saved), never
        // the store data's own codes; a code ending too early says why.
        const listed = pulseCodes(offers, run.start_on, timezone)
        const pulseInput = {
          ...input,
          brand: {
            ...input.brand,
            maxDiscountPercent: offers.maxDiscountPercent,
            // PLN-039b: a code over the margin floor's cap is named for it.
            ...(offers.limitedBy ? { limitedBy: offers.limitedBy } : {})
          },
          codes: listed.codes
        }
        const gathered = agentCtx
          ? (await runBrandPulse(pulseInput, agentCtx)).pulse
          : codePulse(gatherEvidence(pulseInput))
        const pulse = {
          ...gathered,
          leftOut: [...gathered.leftOut, ...listed.leftOut],
          summary: unreadable
            ? `${gathered.summary} ${unreadableWords} none are listed.`
            : gathered.summary
        }
        const done = await db.rpc('finish_strategy_pulse', {
          run: run.id,
          lease: run.lease_token,
          result: {
            ...pulse,
            sample: store.sample,
            own: store.own === true
          } as never
        })
        if (done.error) throw done.error
      } else {
        const stored = storedPulse.safeParse(run.pulse)
        if (!stored.success || stored.data.start !== run.start_on)
          throw final('stored_pulse_invalid')
        // ONB-057b: the offers were listed from one store and the plan would
        // be made from another (the readers finished in between). A pulse
        // saved before the flags was the sample store's.
        if (
          (stored.data.sample ?? true) !== store.sample ||
          (stored.data.own ?? false) !== (store.own === true)
        )
          throw final('store_changed')
        const pick = offerPick.safeParse(run.offer_pick)
        if (!pick.success) throw final('stored_pick_invalid')
        const picked = offersToPlan(stored.data, pick.data)
        if (!picked.ok) throw final('pick_not_in_pulse')
        const mapper = readMapperInput(store.mapper)
        if (mapper.start !== run.start_on) throw final('store_wrong_days')
        // Settings may have changed since the offer step: only picked offers
        // that still work, with their current percent and last send day, and
        // their facts rewritten to match (the emails show these facts).
        const { usable, leftOut } = stillUsable(
          picked.offers,
          offers,
          run.start_on,
          timezone
        )
        const current = new Map(usable.map((o) => [o.id, o]))
        const pulse = {
          ...stored.data,
          offers: usable,
          highlights: stored.data.highlights.flatMap((h) => {
            if (h.kind !== 'offer') return [h]
            const o = current.get(h.id)
            return o
              ? [
                  {
                    ...h,
                    fact: offerFact(o.code, o.percent, o.until, stored.data.end)
                  }
                ]
              : []
          })
        }
        const moves = agentCtx
          ? (await runCompetitorMapper(mapper, agentCtx)).moves
          : codeMoves(mapPatterns(mapper))
        // PICK-WIRE: the goal, the brand's mix and the followed brands'
        // timing and offers; a plan is never stopped for want of them.
        const guidance = await guidanceOf({
          tenantId: run.tenant_id,
          start: run.start_on,
          timezone,
          sendsPerWeek: store.plan.sendsPerWeek,
          offers: usable.length,
          now: now()
        })
          .then((read) => {
            // Advice only: one the plan cannot read is dropped, logged.
            const checked = readGuidance(read)
            if (!checked)
              logger.warn('Plan guidance dropped', { code: 'guidance_invalid' })
            return checked ?? {}
          })
          .catch((error: unknown) => {
            logger.warn('Plan guidance not read', { code: stepCode(error) })
            return {}
          })
        const planInput = {
          ...store.plan,
          start: run.start_on,
          pulse,
          offers: usable,
          moves,
          ...(Object.keys(guidance).length ? { guidance } : {})
        }
        const made = agentCtx
          ? await planFifteenDays(planInput, agentCtx)
          : samplePlan(planInput)
        // REL-OFF: every offer email works at its own send time, as "Create
        // email" will check it. One that would not (a guard: the plan's last
        // send days ensure it) keeps its day without the offer, named in the
        // plan's notes and logged; the plan itself goes on.
        // REL-DAT: never an email outside these 15 days (a guard). A plan
        // with no email at all is fine (no day fits); one this guard
        // empties did not match its days.
        const dated = slotsInWindow(made.slots, run.start_on)
        if (dated.dropped.length && !dated.slots.length)
          throw final('store_wrong_days')
        const dateNote = outsideWindowNote(dated.dropped)
        if (dated.dropped.length)
          await fallbacks.record(
            outsideWindowEntry({
              tenantId: run.tenant_id,
              runId: run.id,
              dropped: dated.dropped
            })
          )
        const checked = withoutUnusableOffers(dated.slots, offers, timezone)
        const dropNote = droppedOffersNote(checked.dropped)
        if (checked.dropped.length)
          await fallbacks.record(
            droppedOffersEntry({
              tenantId: run.tenant_id,
              runId: run.id,
              dropped: checked.dropped
            })
          )
        const note = unreadable
          ? `${unreadableWords} this plan has no offers. Start again to plan with them.`
          : leftOutNote(leftOut)
        // REL-084: an offer the owner picked that no email uses is named.
        // Offers left out above are named once, in their own note.
        const unused =
          pick.data.mode === 'picked'
            ? unusedOffersNote(
                usable,
                new Set(
                  dated.slots.flatMap((s) => (s.offer ? [s.offer.code] : []))
                )
              )
            : null
        const plan = {
          ...made,
          slots: checked.slots,
          // #33: what the plan does toward the goal, after the guards.
          ...(made.goal ? { goal: goalLines(planInput, checked.slots) } : {}),
          notes: [
            ...(note ? [note] : []),
            ...made.notes,
            ...(dateNote ? [dateNote] : []),
            ...(dropNote ? [dropNote] : []),
            ...(unused ? [unused] : [])
          ].slice(0, 10)
        }
        const done = await db.rpc('finish_strategy_plan', {
          run: run.id,
          lease: run.lease_token,
          result: {
            ...plan,
            sample: store.sample,
            own: store.own === true
          } as never
        })
        if (done.error) throw done.error
      }
      ran++
    } catch (error) {
      // Only codes with plain words are stored (REL-084); the log keeps it.
      const thrown = stepCode(error)
      const code = planCode(thrown)
      if (code !== thrown)
        logger.error('Plan step threw', { run: run.id, code: thrown })
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

/** A plan step's tries: `claim_strategy_run` gives up after this many. */
export const planStepTries = 3

const unreadableWords = 'Your saved offers could not be read, so'

/** How many times this step has been claimed (the claim counts them). */
async function attemptsOf(db: Db, runId: string) {
  const { data, error } = await db
    .from('strategy_runs')
    .select('attempts')
    .eq('id', runId)
    .maybeSingle()
  if (error) throw error
  return data?.attempts ?? 0
}

/** A failure a retry cannot fix (bad stored or store data). */
function final(code: PlanFailureCode) {
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
