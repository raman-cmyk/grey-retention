import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import {
  fakeDraftPusher,
  type DraftPusher
} from '@/lib/providers/klaviyo-draft'
import { SupabaseOfferSource, type OfferSource } from '@/features/offers/source'
import { databaseFallbackLog, type FallbackLog } from '@/features/fallback/log'
import { stepCode } from '@/features/strategy/worker'
import { inPlanWindow } from '@/features/strategy/dates'
import { planStore, storeForPlan } from '@/features/onboarding/store-source'
import { planOfferSource } from '@/features/strategy/offers'
import {
  builtEmail,
  codeWorksNow,
  plannedEmail,
  type BuildAgents
} from './build'
import { buildAgentsFor } from './agents'
import { buildSteps, runBuildStep, stepBudgetMs } from './steps'
import { maxStepSaves, roundSteps, maxEmailBytes } from './step-names'
import { buildCode, type BuildFailureCode } from './failure-words'
import { type SavedOffers, type StoreSource } from './ports'
import {
  noPhotos,
  studioPhotos,
  studioPortsFor,
  studioStepMs
} from '@/features/studio/live-ports'
import {
  designStudioOn,
  waitForPictures,
  type claimWaitingDesign
} from '@/features/studio/waits'

type Db = SupabaseClient<Database>
/** A build claimed by the design studio (DST-006b), as `claim_email_build` returns one. */
type ClaimedBuild = NonNullable<Awaited<ReturnType<typeof claimWaitingDesign>>>

/**
 * Runs waiting "Create email" steps (EML-004 part 2, REL-081). Each step is
 * claimed with a lease (`claim_email_build`), so overlapping calls never
 * run one step twice. A build is four saved steps on the code-only path
 * (no AI, `runBuildStep`): sections, content, copy and design, in the
 * workspace's one brand timezone; each step's output is saved
 * (`finish_email_step`) before the next is claimed, and the design step
 * checks and stores the email. The push step hands it to the `DraftPusher`
 * with the planned email's push key, so a retried push or a "Try again"
 * never makes a second draft. A step that throws is tried again a minute
 * later, from the saved steps before it, at most 3 times; a busy Klaviyo
 * waits as long as it asks; bad data, a refused draft and a stored email or
 * step of the wrong shape fail at once. DST-006b: a design step may wait for
 * its pictures (`waiting`, saved with `wait_email_round`), and the design
 * studio's job hands in a build it claimed already (`first`), which runs
 * alone, as the click's build does.
 */
export async function runEmailBuilds(
  db: Db,
  deps: {
    /**
     * Default: the store the plan was made from (ONB-057b): the
     * workspace's own, or the sample store from the plan's first day.
     */
    stores?: StoreSource
    /**
     * Default: what the owner saved in Settings (DSC-001, read with this
     * service-role client); when the owner has saved nothing, the sample
     * offers from the plan's first day for the sample store only, none for
     * the workspace's own (`planOfferSource`, ONB-057b).
     */
    offers?: OfferSource
    /** Default: DSC-001's `SupabaseOfferSource` on `db`. */
    saved?: SavedOffers
    pusher?: DraftPusher
    fallbacks?: FallbackLog
    /**
     * Default: `buildAgentsFor(db)`: the agents when a live model is set up,
     * else null (the code-only path, nothing metered). REL-AI part 2.
     */
    agents?: BuildAgents | null
    /** Run only this build (the owner's click): its steps, then its push. */
    build?: string
    /**
     * DST-006b: `build` already claimed (the design studio's claim of a
     * design step waiting for its pictures, `claimWaitingDesign`): it runs
     * first, then its next steps as the click claims them.
     */
    first?: ClaimedBuild
    /**
     * DST-006c: the design studio in the design step. Default: the
     * owner's switch (`DESIGN_STUDIO=on`); it runs only with the agents.
     */
    studio?: boolean
    /** Steps to run at most; the deadline bounds the sweep. */
    limit?: number
    /** Stop claiming after this time (ms since epoch). */
    deadline?: number
    now?: () => number
  } = {}
) {
  const pusher = deps.pusher ?? fakeDraftPusher()
  const fallbacks =
    deps.fallbacks ??
    databaseFallbackLog(db, (lost) =>
      logger.warn('Fallback could not be recorded', lost)
    )
  const saved = deps.saved ?? new SupabaseOfferSource(db)
  const now = deps.now ?? Date.now
  const agents = deps.agents === undefined ? buildAgentsFor(db) : deps.agents
  const studio = deps.studio ?? designStudioOn(process.env)
  // The owner's click: every step, every save of the steps with rounds
  // (REL-AI part 2b) and the push. Its deadline, not this count, ends it.
  // DST-006b: a build claimed already is the only build this run runs.
  if (deps.first && deps.build !== undefined && deps.build !== deps.first.id)
    throw new Error('A claimed build runs alone')
  const only = deps.build ?? deps.first?.id
  const limit = only
    ? buildSteps.length + 1 + roundSteps.length * maxStepSaves
    : (deps.limit ?? 25)
  let ran = 0
  /**
   * The build this run just moved on (REL-AI part 2b): the database leaves
   * it to this job for 30 seconds, so the sweep claims it by name next and
   * takes it through its steps in one run, as the click does.
   */
  let moved: string | undefined
  let first = deps.first
  const claim = async (target?: string) => {
    const claimed = await db.rpc('claim_email_build', target ? { target } : {})
    if (claimed.error) throw claimed.error
    return claimed.data?.[0]
  }
  for (let n = 0; n < limit; n++) {
    // An agent step can take most of a step's budget (3 tries of 15 s):
    // with the agents on, a new step is claimed only while a whole step
    // still fits before the deadline (REL-AI part 2).
    if (
      !first &&
      deps.deadline &&
      now() + (agents ? stepBudgetMs : 0) > deps.deadline
    )
      break
    // A build claimed already runs first: its lease is this job's.
    let job = first ?? (await claim(only ?? moved))
    first = undefined
    if (!job && !only && moved) job = await claim()
    moved = undefined
    if (!job) break
    const fail = async (
      code: BuildFailureCode,
      final: boolean,
      retryAfterSeconds?: number
    ) => {
      logger.error('Email build step failed', {
        build: job.id,
        step: job.step,
        code
      })
      const failed = await db.rpc('fail_email_step', {
        build: job.id,
        lease: job.lease_token,
        code,
        final,
        ...(retryAfterSeconds
          ? {
              retry_after_seconds: Math.min(
                Math.max(Math.round(retryAfterSeconds), 1),
                86_400
              )
            }
          : {})
      })
      if (failed.error)
        logger.error('Email build step could not be failed', {
          build: job.id,
          code: failed.error.code ?? 'fail_step_error'
        })
    }
    /** A finish the database refused: shape and size errors cannot change on a retry. */
    const refused = (error: { code?: string }) =>
      error.code === '22023' || error.code === '23514'
    try {
      if (job.state === 'build_queued') {
        const planned = plannedEmail.safeParse(job.planned)
        if (!planned.success) {
          await fail('planned_email_invalid', true)
          continue
        }
        // REL-DAT: an email outside its plan's 15 days is never made.
        if (!inPlanWindow(planned.data.date, job.start_on)) {
          await fail('slot_outside_plan', true)
          continue
        }
        // ONB-057b: the store the plan was made from: the sample store's
        // plan builds on the sample store, the workspace's own on its own.
        const plan = await planStore(db, job)
        const stores = deps.stores ?? storeForPlan(db, plan, job.start_on)
        // The workspace's one brand timezone is "store time" everywhere.
        const store = {
          ...(await stores.read(job.tenant_id)),
          timezone: job.timezone
        }
        // Its own store read another way since (live then, fake now, or
        // back): planning again makes a plan from the store as it is.
        if (store.sample !== plan.sample) {
          await fail('plan_store_changed', true)
          continue
        }
        // The owner's offers; when nothing is saved, the sample's only for
        // the sample store, none for the workspace's own.
        const offers =
          deps.offers ??
          planOfferSource(saved, job.start_on, { sample: store.sample })
        const started = now()
        // DST-006e: the studio's design step has longer (its critic's tries
        // and the product's photo); the claims' own deadlines still bound it.
        const studioStep = studio && agents && job.step === 'design'
        const until = Math.min(
          started + (studioStep ? studioStepMs : stepBudgetMs),
          deps.deadline ?? Number.POSITIVE_INFINITY
        )
        // REL-AI: the copy step skips the subjects of the plan's other emails.
        const taken =
          job.step === 'copy' ? await planSubjects(db, job) : undefined
        const step = await runBuildStep(
          job.step ?? '',
          {
            planned: planned.data,
            store,
            offers,
            progress: job.progress,
            taken
          },
          {
            tenantId: job.tenant_id,
            callerKey: `email-build:${job.id}`,
            fallbacks,
            agents,
            // A step with rounds starts a model call only while one fits in
            // this claim's budget and the job's deadline (REL-AI part 2b).
            until,
            clock: now,
            ...(studioStep && agents
              ? {
                  studio: studioPortsFor(db, {
                    tenant: job.tenant_id,
                    build: job.id,
                    lease: job.lease_token,
                    agents,
                    fallbacks,
                    callerKey: `email-build:${job.id}`,
                    industry: store.industry ?? null,
                    // A sample store's photos are never fetched.
                    photos: store.sample ? noPhotos : studioPhotos,
                    until,
                    now
                  })
                }
              : {})
          }
        )
        const took = now() - started
        if (took > until - started)
          logger.warn('Email build step ran long', {
            build: job.id,
            step: job.step,
            ms: took
          })
        if (!step.ok) {
          // A claim without a known step (the app went live before the
          // migration) and saved offers that could not be read are tried
          // again, 3 tries a minute apart; every other code fails at once.
          await fail(
            step.code,
            step.code !== 'step_unknown' && step.code !== 'offers_unreadable'
          )
          continue
        }
        if ('waiting' in step) {
          // DST-006b: only the design step waits for its pictures; the claim
          // ends, and the design studio's job claims it again when they
          // are there (nothing else does before its time is up).
          if (job.step !== 'design') {
            await fail('step_output_invalid', true)
            continue
          }
          const wait = await waitForPictures(db, {
            build: job.id,
            lease: job.lease_token,
            work: step.work,
            seconds: step.seconds
          })
          if (!wait.ok) {
            if (wait.reason === 'lease') {
              logger.warn('Email build step lost its lease', {
                build: job.id,
                step: job.step
              })
              continue
            }
            // The seventh wait (the pictures kept not coming): tried again,
            // the next claim draws it coded (D16). The wrong step or refused
            // work: final, with its reason.
            await fail(
              wait.reason === 'too_many'
                ? 'step_timed_out'
                : 'step_output_invalid',
              wait.reason !== 'too_many'
            )
            continue
          }
          ran++
          continue
        }
        if ('saved' in step) {
          // A step saves only its own rounds (the database would refuse).
          if (step.saved !== job.step) {
            await fail('step_output_invalid', true)
            continue
          }
          // REL-AI part 2b: the step ran what fitted in its time; its rounds
          // are saved and the claim ends, its try given back. The click
          // claims it again at once and goes on from them.
          const kept = await db.rpc('save_email_round', {
            build: job.id,
            lease: job.lease_token,
            step: step.saved,
            work: step.work as never
          })
          if (kept.error) {
            if (refused(kept.error)) {
              // The 17th save: the step kept stopping before it finished.
              const many =
                (kept.error as { details?: string }).details ===
                'too_many_rounds'
              await fail(many ? 'step_timed_out' : 'step_output_invalid', true)
              continue
            }
            throw kept.error
          }
          moved = job.id
          ran++
          continue
        }
        if (step.done !== 'design') {
          // Saved before the next step is claimed: a retry starts here.
          const kept = await db.rpc('finish_email_step', {
            build: job.id,
            lease: job.lease_token,
            done: step.done,
            output: step.output as never
          })
          if (kept.error) {
            if (refused(kept.error)) {
              await fail('step_output_invalid', true)
              continue
            }
            // REL-AI1b: another email of the plan saved this subject first
            // (two clicks at once). Tried again, the copy step reads the
            // plan's subjects afresh; after its tries it says why.
            if (
              kept.error.code === 'PT409' &&
              (kept.error as { details?: string }).details === 'subject_taken'
            ) {
              await fail('subject_taken', false)
              continue
            }
            throw kept.error
          }
          moved = job.id
          ran++
          continue
        }
        const email = builtEmail.safeParse(step.email)
        if (!email.success) {
          await fail('built_email_invalid', true)
          continue
        }
        if (Buffer.byteLength(JSON.stringify(email.data)) > maxEmailBytes) {
          await fail('email_too_large', true)
          continue
        }
        const done = await db.rpc('finish_email_build', {
          build: job.id,
          lease: job.lease_token,
          result: email.data as never
        })
        if (done.error) {
          if (refused(done.error)) {
            await fail('built_email_invalid', true)
            continue
          }
          throw done.error
        }
      } else {
        const email = builtEmail.safeParse(job.email)
        if (!email.success) {
          await fail('built_email_invalid', true)
          continue
        }
        // REL-OFF: the last gate before Klaviyo. A push can wait on Klaviyo
        // for a long time: its code must still work with Settings now.
        if (email.data.code !== null) {
          const now = await codeWorksNow(
            email.data.code,
            // The same offers the email was built from (ONB-057b).
            deps.offers ??
              planOfferSource(saved, job.start_on, {
                sample: email.data.sample
              }),
            job.tenant_id,
            email.data.plannedSendAt,
            email.data.offer
          )
          if (now !== 'ok') {
            await fail(
              now === 'unsafe' ? 'offer_unsafe' : 'offers_unreadable',
              now === 'unsafe'
            )
            continue
          }
        }
        const pushed = await pusher.createDraft({
          tenantId: job.tenant_id,
          idempotencyKey: job.push_key,
          name: email.data.name,
          subject: email.data.subject,
          preheader: email.data.preheader,
          html: email.data.html,
          plannedSendAt: email.data.plannedSendAt,
          audienceId: email.data.audienceId,
          sample: email.data.sample,
          // The live pusher saves its steps under this build's lease (PSH-001).
          lease: { build: job.id, token: job.lease_token }
        })
        if (!pushed.ok) {
          await fail(
            `klaviyo_${pushed.code}`,
            pushed.code === 'auth' || pushed.code === 'rejected',
            pushed.retryAfterSeconds
          )
          continue
        }
        // If recording fails, the retry pushes with the same key and gets
        // the same draft back.
        const done = await db.rpc('finish_email_push', {
          build: job.id,
          lease: job.lease_token,
          campaign: pushed.campaignId,
          sample: pushed.sample
        })
        if (done.error) throw done.error
      }
      moved = job.id
      ran++
    } catch (error) {
      // Only codes with plain words are stored (REL-084); the log keeps it.
      const code = stepCode(error)
      if (buildCode(code) !== code)
        logger.error('Email build step threw', { build: job.id, code })
      await fail(buildCode(code), false)
    }
  }
  return { ran }
}

/**
 * The subjects the plan's other planned emails already have (REL-AI): a
 * stored email's, or a saved copy step's. A failed build's subject is free
 * again unless it reached the push (its Klaviyo draft may still carry it);
 * this email's own builds (its "Try again") never count.
 */
export async function planSubjects(
  db: Db,
  job: { tenant_id: string; run_id: string; slot: number }
): Promise<string[]> {
  const { data, error } = await db
    .from('email_builds')
    .select('built:email->>subject,saved:progress->copy->draft->>subject')
    .eq('tenant_id', job.tenant_id)
    .eq('run_id', job.run_id)
    .neq('slot', job.slot)
    .or('state.neq.failed,email.not.is.null')
  if (error) throw error
  // Either path may be missing (a build before its copy step).
  const rows = (data ?? []) as {
    built: string | null
    saved: string | null
  }[]
  return rows.flatMap((r) =>
    [r.built, r.saved].filter((x): x is string => typeof x === 'string')
  )
}
