import 'server-only'
import { learnAfterBuild } from '@/features/learning/run'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import {
  fakeDraftPusher,
  type DraftInput,
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
  type BuildAgents,
  type BuiltEmail
} from './build'
import { buildAgentsFor, emailAgentsReady } from './agents'
import { fittedEmail } from './reasons'
import { restoreRefusal, restoreUnread } from './restore-checks'
import { buildSteps, runBuildStep, stepBudgetMs } from './steps'
import { libraryCopyOn } from './library-copy'
import { libraryPortsFor } from './library-copy-live'
import { libraryScratchOn } from './scratch-switch'
import { uploadCopyOn } from '@/features/email-uploads/switch'
import { maxStepSaves, roundSteps, maxEmailBytes } from './step-names'
import { buildCode, refusedCode, type BuildFailureCode } from './failure-words'
import {
  storedRefusal,
  type KlaviyoRefusal
} from '@/features/results/never-overwrite'
import { type SavedOffers, type StoreSource } from './ports'
import type { ReferenceEmail } from '@/features/studio/reference'
import {
  readReferenceRows,
  toReferences
} from '@/features/studio/reference-source'
import {
  noPhotos,
  studioPhotos,
  emailPortsFor,
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
    /** LRN-002b, after a finished build. Default: `learnAfterBuild`. */
    learn?: (db: Db, tenantId: string) => Promise<unknown>
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
    /**
     * DES-ENGINE-002b2: the library copy in a Copy email's design step.
     * Default: the owner's switch (`DESIGN_LIBRARY_COPY=on`).
     */
    library?: boolean
    /** DES-ENGINE-004b: Scratch from the block library (`DESIGN_LIBRARY_SCRATCH=on`). */
    scratch?: boolean
    /** DES-ENGINE-003b: copying uploads (`DESIGN_UPLOAD_COPY=on`). */
    uploads?: boolean
    /**
     * DST-002b: how a Copy or Remix build's references are read. Default:
     * the Inspiration inbox with this service-role client
     * (`readReferenceRows`, `toReferences`).
     */
    references?: ReferenceLoader
    /**
     * PICK-99: what the owner did in Klaviyo with this planned email's
     * draft (by its push key), as the results sync last read it: a push is
     * refused before the pusher is called. Default: `storedRefusal` on `db`.
     */
    klaviyoState?: (
      tenantId: string,
      pushKey: string
    ) => Promise<KlaviyoRefusal | null>
    /**
     * PICK-106: whether Klaviyo holds this planned email already (a push
     * row of its key with a campaign, or a restore of a real draft) and
     * whether the push is a restore. Default: `pushFactsOf(db)`.
     */
    pushFacts?: (
      tenantId: string,
      pushKey: string,
      build: string
    ) => Promise<PushFacts>
    /**
     * PICK-106: a restore's own checks, run here so no caller can skip
     * them (`restoreRefusal`: never-overwrite, the code, the hard checks
     * under today's rules, the owner's never-words). Null: it may go.
     */
    restoreCheck?: (
      job: {
        tenant_id: string
        run_id: string
        start_on: string
        push_key: string
      },
      email: BuiltEmail
    ) => Promise<string | null>
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
  const library = deps.library ?? libraryCopyOn(process.env)
  const uploadOn = deps.uploads ?? uploadCopyOn(process.env)
  const scratchOn = deps.scratch ?? libraryScratchOn(process.env)
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
        // DES-ENGINE-003b: the owner's own uploaded email this build copies,
        // for its design step (with the owner's switch on).
        const upload =
          job.step === 'design' && uploadOn
            ? await buildUpload(db, job)
            : undefined
        // DES-ENGINE-004b: a Scratch email's design step, with the library
        // on, picks its sections from the block library (a text email has
        // no design to pick).
        const scratch =
          job.step === 'design' &&
          scratchOn &&
          !upload &&
          planned.data.format !== 'text'
            ? await buildIsScratch(db, job)
            : false
        // DST-002b: the owner's Copy or Remix, for the step that plans it.
        // A text email is never copied or remixed (DST-002b1): no read.
        const reference =
          job.step === 'sections' && planned.data.format !== 'text'
            ? await buildReference(
                db,
                job,
                store.timezone,
                now,
                deps.references
              )
            : undefined
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
            ...(reference ? { reference } : {}),
            // DES-ENGINE-002b2: a Copy email's design copied for the brand;
            // DES-ENGINE-003b: or the workspace's own uploaded email.
            ...((library || upload || scratch) && job.step === 'design'
              ? {
                  library: libraryPortsFor(db, {
                    tenant: job.tenant_id,
                    build: job.id,
                    lease: job.lease_token,
                    ...(upload ? { upload } : {}),
                    ...(scratch ? { scratch: true } : {})
                  })
                }
              : {}),
            // The owner's studio is on, but this claim has no agents (the
            // sweep, after the click ran out of time): it says so (D16).
            ...(studio &&
            !agents &&
            job.step === 'design' &&
            emailAgentsReady(process.env)
              ? { studioSkipped: true }
              : {}),
            ...(studioStep && agents
              ? {
                  studio: {
                    ...studioPortsFor(db, {
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
                    }),
                    // DST-006d: the email judged whole from its inbox views.
                    email: emailPortsFor(db, {
                      tenant: job.tenant_id,
                      build: job.id,
                      lease: job.lease_token,
                      agents,
                      fallbacks,
                      callerKey: `email-build:${job.id}`,
                      industry: store.industry ?? null,
                      email: {
                        emailType: planned.data.emailType,
                        angle: planned.data.angle,
                        brand: store.brand.name
                      }
                    })
                  }
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
        if ('reasonsFailed' in step && step.reasonsFailed)
          logger.warn('Email design reasons not made', { build: job.id })
        const email = builtEmail.safeParse(step.email)
        if (!email.success) {
          await fail('built_email_invalid', true)
          continue
        }
        // PICK-104: an email too large with its reasons is kept without them.
        const fitted = fittedEmail(email.data, maxEmailBytes)
        if (!fitted) {
          await fail('email_too_large', true)
          continue
        }
        if (fitted !== email.data)
          logger.warn('Email design reasons dropped for size', {
            build: job.id
          })
        const done = await db.rpc('finish_email_build', {
          build: job.id,
          lease: job.lease_token,
          result: fitted as never
        })
        if (done.error) {
          if (refused(done.error)) {
            await fail('built_email_invalid', true)
            continue
          }
          throw done.error
        }
        // LRN-002b: what the checks kept rejecting becomes a "don't" for
        // the writers (code only, keyed writes; never throws).
        await (deps.learn ?? learnAfterBuild)(db, job.tenant_id)
      } else {
        const email = builtEmail.safeParse(job.email)
        if (!email.success) {
          await fail('built_email_invalid', true)
          continue
        }
        // PICK-99: never overwrite the owner's work. A draft of this
        // planned email (same push key) he scheduled, sent, deleted,
        // cancelled or changed in Klaviyo is left as it is.
        const owners = await (deps.klaviyoState
          ? deps.klaviyoState(job.tenant_id, job.push_key)
          : storedRefusal(db, job.tenant_id, job.push_key))
        if (owners) {
          await fail(refusedCode(owners), true)
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
        const input: DraftInput = {
          tenantId: job.tenant_id,
          idempotencyKey: job.push_key,
          name: email.data.name,
          subject: email.data.subject,
          preheader: email.data.preheader,
          html: email.data.html,
          plannedSendAt: email.data.plannedSendAt,
          audienceId: email.data.audienceId,
          sample: email.data.sample,
          // EML-AB: both designs in one draft, half the audience each.
          ...(email.data.designA && email.data.approach === 'B'
            ? {
                variations: [
                  { approach: 'A' as const, html: email.data.designA },
                  { approach: 'B' as const, html: email.data.html }
                ]
              }
            : // PIC-26 part 3b: or its two subjects, on the one design.
              email.data.subjectB && email.data.text === undefined
              ? {
                  variations: [
                    { approach: 'A' as const, html: email.data.html },
                    {
                      approach: 'B' as const,
                      html: email.data.html,
                      subject: email.data.subjectB
                    }
                  ]
                }
              : {}),
          // TXT-001d: a text email's own plain-text part (TXT-001e).
          ...(email.data.text !== undefined ? { text: email.data.text } : {}),
          // The live pusher saves its steps under this build's lease (PSH-001).
          lease: { build: job.id, token: job.lease_token }
        }
        // PICK-106: a planned email Klaviyo already holds (a real draft, or
        // a key the live pusher put in Klaviyo) never goes to the fake
        // pusher, which would leave that draft as it is and call this a
        // sample draft: the push switch was turned off. A restore is
        // checked here again, whoever queued it. Either refusal comes
        // before anything is written: a restore goes back to its draft.
        const facts = await (deps.pushFacts ?? pushFactsOf(db))(
          job.tenant_id,
          job.push_key,
          job.id
        )
        if (pusher.fake?.(input) && facts.realDraft) {
          await fail('push_switched_off', true)
          continue
        }
        const refused = facts.restore
          ? await (deps.restoreCheck ?? restoreCheckOf(db))(job, email.data)
          : null
        if (refused) {
          // What it needs could not be read: tried again (after its last
          // try, the draft is kept as it was); else refused for good.
          const unread = restoreUnread.has(refused)
          await fail(unread ? 'restore_unchecked' : 'restore_unsafe', !unread)
          continue
        }
        const pushed = await pusher.createDraft(input)
        if (!pushed.ok) {
          // REL-084c: a refusal by the app's own checks keeps its reason,
          // on this build (an earlier try's push row may still say another).
          await fail(
            pushed.code === 'rejected'
              ? refusedCode(pushed.reason)
              : `klaviyo_${pushed.code}`,
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
        // EML-AB: the draft could not hold both designs (Klaviyo refused
        // the even test, or the draft was made with one design before), so
        // it has design A only; the owner's log says so, once per planned
        // email (its push key). Written after the push is recorded: a crash
        // between the two loses this line, never the draft.
        const subjectTest = !email.data.designA && !!email.data.subjectB
        if (pushed.designs === 'A')
          await fallbacks.record(
            subjectTest
              ? {
                  tenantId: job.tenant_id,
                  campaignId: null,
                  agent: 'ab-test',
                  reasonCode: 'ab_one_subject',
                  reason:
                    'This email’s Klaviyo draft could not hold both subjects.',
                  fallback:
                    'The draft in Klaviyo has the first subject only, with no A/B test.',
                  attempts: 1,
                  detail: {},
                  dedupeKey: `ab-test:${job.push_key}:one-subject`
                }
              : {
                  tenantId: job.tenant_id,
                  campaignId: null,
                  agent: 'ab-test',
                  reasonCode: 'ab_one_design',
                  reason:
                    'This email’s Klaviyo draft could not hold both designs.',
                  fallback:
                    'The draft in Klaviyo has the coded design only, with no A/B test.',
                  attempts: 1,
                  detail: {},
                  dedupeKey: `ab-test:${job.push_key}:one-design`
                }
          )
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

/** PICK-106: what the push step knows of a planned email's draft. */
export type PushFacts = {
  /** Klaviyo holds it: a push row with a campaign, or a restore of a real draft. */
  realDraft: boolean
  /** This push is a restore ("Use this version"). */
  restore: boolean
}

/**
 * PICK-106: whether Klaviyo already holds this planned email (the live
 * pusher made a campaign for its key, or the build is a restore of a real
 * draft), and whether the push is a restore. A read that fails throws (the
 * push waits for its next try).
 */
export const pushFactsOf =
  (db: Db) =>
  async (
    tenantId: string,
    pushKey: string,
    build: string
  ): Promise<PushFacts> => {
    const [pushes, builds] = await Promise.all([
      db
        .from('klaviyo_draft_pushes')
        .select('campaign_id')
        .eq('tenant_id', tenantId)
        .eq('push_key', pushKey),
      db
        .from('email_builds')
        .select('sample_draft,restore_version')
        .eq('tenant_id', tenantId)
        .eq('id', build)
    ])
    if (pushes.error) throw pushes.error
    if (builds.error) throw builds.error
    const b = (builds.data ?? [])[0] as
      { sample_draft: boolean; restore_version: string | null } | undefined
    const restore = !!b && b.restore_version !== null
    return {
      realDraft:
        (pushes.data ?? []).some(
          (p) => (p as { campaign_id: string | null }).campaign_id !== null
        ) ||
        (restore && !b!.sample_draft),
      restore
    }
  }

/** PICK-106: a restore's checks, with the worker's own client and sources. */
export const restoreCheckOf =
  (db: Db) =>
  (
    job: {
      tenant_id: string
      run_id: string
      start_on: string
      push_key: string
    },
    email: BuiltEmail
  ) =>
    restoreRefusal(db, {
      tenantId: job.tenant_id,
      runId: job.run_id,
      startOn: job.start_on,
      pushKey: job.push_key,
      email
    })

type ReferenceLoader = (
  tenantId: string,
  /** UI-USE: the email the owner chose, read even when it is not recent. */
  chosen?: string
) => Promise<{
  emails: readonly ReferenceEmail[]
  followed: ReadonlySet<string>
}>

/**
 * DST-002b: the owner's Copy or Remix for a build, and how its references
 * are read (the Inspiration inbox, service role, at the step's own time).
 * Undefined: Scratch (the mode every build had before, and the default).
 */
export async function buildReference(
  db: Db,
  job: { id: string; tenant_id: string },
  timezone: string,
  now: () => number,
  load?: ReferenceLoader
) {
  const read = (columns: string) =>
    db
      .from('email_builds')
      .select(columns)
      .eq('id', job.id)
      .eq('tenant_id', job.tenant_id)
  // UI-USE: `reference_id` is not in the generated types until they are
  // regenerated (BUILD_LEDGER Known issues); this read names its shape.
  type Row = {
    mode: string
    reference_id?: string | null
    upload_id?: string | null
  }
  let found = (await read('mode,reference_id,upload_id')) as unknown as {
    data: Row[] | null
    error: { code?: string } | null
  }
  // The app can go live minutes before the migration that adds the
  // column (42703 = no such column): the build goes on without a choice.
  if (found.error?.code === '42703')
    found = (await read('mode')) as unknown as typeof found
  if (found.error) throw found.error
  const row = (found.data ?? [])[0]
  // DES-ENGINE-003b: a copy of the owner's own uploaded email follows no
  // inspiration email; its sections are planned as for Scratch (the
  // coded email it falls back to), and its design step copies the upload.
  if (row?.upload_id) return undefined
  const mode = row?.mode
  if (mode !== 'copy' && mode !== 'remix') return undefined
  const chosen =
    typeof row?.reference_id === 'string' ? row.reference_id : undefined
  return {
    mode,
    ...(chosen ? { chosen } : {}),
    load: load
      ? () => load(job.tenant_id, chosen)
      : async () => {
          const at = now()
          return toReferences(
            await readReferenceRows(db, job.tenant_id, at, chosen),
            { now: at, timezone }
          )
        }
  } as const
}

/**
 * DES-ENGINE-004b: whether a build is a Scratch email (mode `scratch`, no
 * inspiration email chosen, no upload), the one the library builds.
 */
export async function buildIsScratch(
  db: Db,
  job: { id: string; tenant_id: string }
): Promise<boolean> {
  const { data, error } = await db
    .from('email_builds')
    .select('mode,reference_id,upload_id')
    .eq('id', job.id)
    .eq('tenant_id', job.tenant_id)
    .maybeSingle()
  if (error) throw error
  return data?.mode === 'scratch' && !data.reference_id && !data.upload_id
}

/** DES-ENGINE-003b: the upload a build copies (`email_builds.upload_id`), if any. */
export async function buildUpload(
  db: Db,
  job: { id: string; tenant_id: string }
): Promise<string | undefined> {
  const { data, error } = await db
    .from('email_builds')
    .select('upload_id')
    .eq('id', job.id)
    .eq('tenant_id', job.tenant_id)
    .maybeSingle()
  if (error) throw error
  return typeof data?.upload_id === 'string' ? data.upload_id : undefined
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
    .select(
      'built:email->>subject,saved:progress->copy->draft->>subject,letter:progress->copy->letter->>subject,builtB:email->>subjectB,savedB:progress->copy->subjectLab->b->>subject'
    )
    .eq('tenant_id', job.tenant_id)
    .eq('run_id', job.run_id)
    .neq('slot', job.slot)
    .or('state.neq.failed,email.not.is.null')
  if (error) throw error
  // Either path may be missing (a build before its copy step).
  const rows = (data ?? []) as {
    built: string | null
    saved: string | null
    /** TXT-001d: a text email's saved letter. */
    letter?: string | null
    /** PIC-26 part 3b: the subject it tests, half the audience gets it too. */
    builtB?: string | null
    savedB?: string | null
  }[]
  return rows.flatMap((r) =>
    [r.built, r.saved, r.letter, r.builtB, r.savedB].filter(
      (x): x is string => typeof x === 'string'
    )
  )
}
