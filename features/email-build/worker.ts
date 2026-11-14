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
import { buildEmail, builtEmail, plannedEmail } from './build'
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
 * Runs waiting "Create email" steps (EML-004 part 2). Each step is claimed
 * with a lease (`claim_email_build`), so overlapping calls never run one
 * step twice. The build step makes the email on the code-only path (no
 * AI, `buildEmail`) in the workspace's one brand timezone, checks it and
 * stores it; the push step hands it to the `DraftPusher` with the planned
 * email's push key, so a retried push or a "Try again" never makes a second
 * draft. A step that throws is tried again a minute later, at most 3
 * times; a busy Klaviyo waits as long as it asks; bad data, a refused
 * draft and a stored email of the wrong shape fail at once.
 */
export async function runEmailBuilds(
  db: Db,
  deps: {
    /** Default: the sample store from the plan's first day. */
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
    /** Run only this build (the owner's click): its build, then its push. */
    build?: string
    /** Steps to run at most; the deadline bounds the sweep. */
    limit?: number
    /** Stop claiming after this time (ms since epoch). */
    deadline?: number
    now?: () => number
  } = {}
) {
  const pusher = deps.pusher ?? fakeDraftPusher()
  const fallbacks = deps.fallbacks ?? databaseFallbackLog(db)
  const saved = deps.saved ?? new SupabaseOfferSource(db)
  const now = deps.now ?? Date.now
  const limit = deps.build ? 2 : (deps.limit ?? 10)
  let ran = 0
  for (let n = 0; n < limit; n++) {
    if (deps.deadline && now() > deps.deadline) break
    const claimed = await db.rpc(
      'claim_email_build',
      deps.build ? { target: deps.build } : {}
    )
    if (claimed.error) throw claimed.error
    const job = claimed.data?.[0]
    if (!job) break
    const fail = async (
      code: string,
      final: boolean,
      retryAfterSeconds?: number
    ) => {
      logger.error('Email build step failed', { build: job.id, code })
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
        const stores = deps.stores ?? sampleStoreFrom(job.start_on)
        const offers =
          deps.offers ??
          ownerOrSampleOffers(saved, sampleOffersFrom(job.start_on))
        // The workspace's one brand timezone is "store time" everywhere.
        const store = {
          ...(await stores.read(job.tenant_id)),
          timezone: job.timezone
        }
        const built = await buildEmail(
          { planned: planned.data, store, offers },
          {
            tenantId: job.tenant_id,
            callerKey: `email-build:${job.id}`,
            fallbacks
          }
        )
        if (!built.ok) {
          await fail(built.code, true)
          continue
        }
        const email = builtEmail.safeParse(built.email)
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
      await fail(stepCode(error), false)
    }
  }
  return { ran }
}
