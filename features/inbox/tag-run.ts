import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { inboxTagging } from '@/features/intelligence/live'
import { labelInboxEmails, type LabelRun } from './label'
import { liveVariantMs, makeInboxVariants, type VariantRun } from './variants'

/** Time after which the tagging run starts no new work. */
export const tagRunMs = 28_000
/** The longest one tagging call may take in this run. */
export const tagCallTimeoutMs = 10_000
/**
 * The block library's share at the start of the run (CI-002): its jobs
 * come from emails tagged earlier, and a structure already in the library
 * needs no call, so it rarely uses all of it; tagging has the rest.
 */
export const variantShareMs = 12_000

export type TagRun =
  | ({
      state: 'done'
      live: boolean
      /** Tagged sections placed in the block library (CI-002). */
      variants: VariantRun | { state: 'failed'; code: string }
    } & LabelRun)
  | { state: 'failed'; code: string }

/**
 * The tagging run (CI-003): the same leased `inbox.label` jobs the sweep
 * works (and first, within `variantShareMs`, the `inbox.variant` jobs that
 * place tagged sections in the block library, CI-002), but with a run to
 * itself instead of what is left of the sweep's
 * 15 seconds, so live tagging keeps up with the inbox. Leases keep the sweep
 * and this run off the same email at the same time; a job cut short or
 * stopped by the platform's AI budget is put back without using a try.
 *
 * Fitting the route's 60 seconds: no new work starts after `tagRunMs`, and
 * each call is capped at `tagCallTimeoutMs`, so the last piece of work (at
 * most two calls one after the other, plus picture downloads) still ends
 * well before Vercel would stop the function. It never throws.
 */
export async function runTagging(
  db: SupabaseClient<Database>,
  options: {
    budgetMs?: number
    env?: NodeJS.ProcessEnv
    label?: typeof labelInboxEmails
    variants?: typeof makeInboxVariants
  } = {}
): Promise<TagRun> {
  const started = Date.now()
  const label = options.label ?? labelInboxEmails
  const place = options.variants ?? makeInboxVariants
  const base = options.env ?? process.env
  const configured = Number(base.GEMINI_TIMEOUT_MS)
  const env = {
    ...base,
    GEMINI_TIMEOUT_MS: String(
      Number.isFinite(configured) && configured > 0
        ? Math.min(configured, tagCallTimeoutMs)
        : tagCallTimeoutMs
    )
  } as NodeJS.ProcessEnv
  try {
    const { ask, pictures, batchMs } = inboxTagging(db, env)
    const deadline = started + (options.budgetMs ?? tagRunMs)
    // The library first, within its share; a failure there never stops
    // the tagging.
    let variants: VariantRun | { state: 'failed'; code: string }
    try {
      variants = await place(
        db,
        ask,
        Math.min(deadline, started + variantShareMs),
        { pictures, batchMs: batchMs ? liveVariantMs : 0 }
      )
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'variant_run_error'
      logger.error('Library part of the tagging run failed', { code })
      variants = { state: 'failed', code }
    }
    const run = await label(db, ask, deadline, { pictures, batchMs })
    logger.info('Tagging run finished', { ...run, live: pictures })
    return { state: 'done', live: pictures, variants, ...run }
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'tag_run_error'
    logger.error('Tagging run failed', { code })
    return { state: 'failed', code }
  }
}
