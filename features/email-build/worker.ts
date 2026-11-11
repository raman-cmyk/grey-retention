import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { databaseFallbackLog, type FallbackLog } from '@/features/fallback/log'
import { stepCode } from '@/features/strategy/worker'
import { buildEmail, builtEmail, plannedEmail } from './build'
import {
  fakeDraftPusher,
  sampleOffers,
  sampleStoreSource,
  type DraftPusher,
  type StoreSource
} from './ports'
import type { OfferSource } from '@/features/offers/source'

type Db = SupabaseClient<Database>

/**
 * Runs waiting "Create email" steps (EML-004 part 2). Each step is claimed
 * with a lease (`claim_email_build`), so overlapping calls never run one
 * step twice. The build step makes the email on the code-only path (no
 * AI, `buildEmail`) and stores it; the push step hands it to the
 * `DraftPusher` with the build's id as the idempotency key, so a retried
 * push never makes a second draft. A step that throws is tried again a
 * minute later, at most 3 times; a busy Klaviyo waits as long as it asks;
 * bad data and a refused draft fail at once.
 */
export async function runEmailBuilds(
  db: Db,
  deps: {
    stores?: StoreSource
    offers?: OfferSource
    pusher?: DraftPusher
    fallbacks?: FallbackLog
    /** Run only this build (the owner's click): its build, then its push. */
    build?: string
    /** Steps to run at most. */
    limit?: number
    /** Stop claiming after this time (ms since epoch). */
    deadline?: number
    now?: () => number
  } = {}
) {
  const stores = deps.stores ?? sampleStoreSource
  const offers = deps.offers ?? sampleOffers
  const pusher = deps.pusher ?? fakeDraftPusher()
  const fallbacks = deps.fallbacks ?? databaseFallbackLog(db)
  const now = deps.now ?? Date.now
  const limit = deps.build ? 2 : (deps.limit ?? 2)
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
      await db.rpc('fail_email_step', {
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
    }
    try {
      if (job.state === 'build_queued') {
        const planned = plannedEmail.safeParse(job.planned)
        if (!planned.success) {
          await fail('planned_email_invalid', true)
          continue
        }
        const store = await stores.read(job.tenant_id)
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
        const done = await db.rpc('finish_email_build', {
          build: job.id,
          lease: job.lease_token,
          result: built.email as never
        })
        if (done.error) throw done.error
      } else {
        const email = builtEmail.safeParse(job.email)
        if (!email.success) {
          await fail('built_email_invalid', true)
          continue
        }
        const pushed = await pusher.createDraft({
          tenantId: job.tenant_id,
          idempotencyKey: job.id,
          name: email.data.name,
          subject: email.data.subject,
          preheader: email.data.preheader,
          html: email.data.html,
          plannedSendAt: email.data.plannedSendAt,
          audienceId: email.data.audienceId
        })
        if (!pushed.ok) {
          await fail(
            `klaviyo_${pushed.code}`,
            pushed.code === 'auth' || pushed.code === 'rejected',
            pushed.retryAfterSeconds
          )
          continue
        }
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
