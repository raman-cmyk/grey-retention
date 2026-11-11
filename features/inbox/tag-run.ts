import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { inboxTagging } from '@/features/intelligence/live'
import { labelInboxEmails, type LabelRun } from './label'

/** Time after which the tagging run starts no new work. */
export const tagRunMs = 28_000
/** The longest one tagging call may take in this run. */
export const tagCallTimeoutMs = 10_000

export type TagRun =
  | ({ state: 'done'; live: boolean } & LabelRun)
  | { state: 'failed'; code: string }

/**
 * The tagging run (CI-003): the same leased `inbox.label` jobs the sweep
 * works, but with a run to itself instead of what is left of the sweep's
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
  } = {}
): Promise<TagRun> {
  const started = Date.now()
  const label = options.label ?? labelInboxEmails
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
    const run = await label(db, ask, started + (options.budgetMs ?? tagRunMs), {
      pictures,
      batchMs
    })
    logger.info('Tagging run finished', { ...run, live: pictures })
    return { state: 'done', live: pictures, ...run }
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'tag_run_error'
    logger.error('Tagging run failed', { code })
    return { state: 'failed', code }
  }
}
