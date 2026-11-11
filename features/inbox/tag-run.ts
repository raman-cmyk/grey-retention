import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { inboxTagging } from '@/features/intelligence/live'
import { labelInboxEmails, type LabelRun } from './label'

/** Time the tagging run gives itself; the route allows 60 seconds. */
export const tagRunMs = 45_000

export type TagRun =
  | ({ state: 'done'; live: boolean } & LabelRun)
  | { state: 'failed'; code: string }

/**
 * The tagging run (CI-003): the same `inbox.label` jobs the sweep works,
 * but with a whole run to itself instead of what is left of the sweep's
 * 15 seconds, so live tagging keeps up with the inbox. Jobs are leased, so
 * this and the sweep never tag the same email twice; a job cut short or
 * stopped by the platform's AI budget is put back without using a try.
 * It never throws.
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
  try {
    const { ask, pictures, batchMs } = inboxTagging(db, options.env)
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
