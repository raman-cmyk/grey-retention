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
import { onboardedStoreSource } from '@/features/onboarding/store-source'
import { builtEmail, plannedEmail, type BuildAgents } from './build'
import { buildAgentsFor } from './agents'
import { buildSteps, runBuildStep, stepBudgetMs } from './steps'
import { buildCode, type BuildFailureCode } from './failure-words'
import {
  ownerOrSampleOffers,
  sampleOffersFrom,
  sampleStoreFrom,
  type SavedOffers,
  type StoreSource
} from './ports'

type Db = SupabaseClient<Database>

/** The stored email stays well inside the table's 300,000-byte limit. */
export const maxEmailBytes = 290_000

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
 * step of the wrong shape fail at once.
 */
export async function runEmailBuilds(
  db: Db,
  deps: {
    /**
     * Default: the workspace's own store once its catalog is read
     * (ONB-057b), else the sample store from the plan's first day.
     */
    stores?: StoreSource
    /**
     * Default: what the owner saved in Settings (DSC-001, read with this
     * service-role client), or the sample offers from the plan's first day
     * when the owner has saved nothing (`ownerOrSampleOffers`).
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
  const limit = deps.build ? buildSteps.length + 1 : (deps.limit ?? 25)
  let ran = 0
  for (let n = 0; n < limit; n++) {
    // An agent step can take most of a step's budget (3 tries of 15 s):
    // with the agents on, a new step is claimed only while a whole step
    // still fits before the deadline (REL-AI part 2).
    if (deps.deadline && now() + (agents ? stepBudgetMs : 0) > deps.deadline)
      break
    const claimed = await db.rpc(
      'claim_email_build',
      deps.build ? { target: deps.build } : {}
    )
    if (claimed.error) throw claimed.error
    const job = claimed.data?.[0]
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
        const stores =
          deps.stores ??
          onboardedStoreSource(db, { fallback: sampleStoreFrom(job.start_on) })
        const offers =
          deps.offers ??
          ownerOrSampleOffers(saved, sampleOffersFrom(job.start_on))
        // The workspace's one brand timezone is "store time" everywhere.
        const store = {
          ...(await stores.read(job.tenant_id)),
          timezone: job.timezone
        }
        const started = now()
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
            agents
          }
        )
        const took = now() - started
        if (took > stepBudgetMs)
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
