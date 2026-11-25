import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { staleBooks, within } from './brand-book'
import {
  runBrandBookWrites,
  writeOnboardedBrandBook
} from './brand-book-writes'
import {
  booksNeedingStrategy,
  runBrandStrategist,
  strategistCallMs,
  strategistReady
} from './strategist-run'
import { classifyFailure } from '@/features/integrations/failures'
import { runAdsReadingJob } from './ads/live'
import { adsRunMs } from './ads/worker'
import { runReviewsReadingJob } from './reviews/live'
import { reviewsRunMs } from './reviews/worker'
import { runCatalogReadingJob } from './catalog/live'
import { catalogRunMs } from './catalog/worker'
import { runHistoryReadingJob } from './history/live'
import { historyRunMs } from './history/worker'
import {
  dbMarginMs,
  jobFailure,
  readersRunMs,
  runSiteReadingJob,
  siteCallTimeoutMs,
  siteRunMs
} from './site/live'

type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']

/**
 * The longest one source read takes: no page or model call starts without
 * the time it may take, so a read ends by its own limit.
 */
export const sourceRunMs = Math.max(
  siteRunMs,
  catalogRunMs,
  historyRunMs,
  adsRunMs,
  reviewsRunMs
)
export { dbMarginMs, readersRunMs, siteCallTimeoutMs }
/** The route's own limit (`maxDuration`). */
export const routeMs = 60_000
/** The longest a Brand book write may take (a few small reads, one save). */
export const bookMs = 4_000

export type ReadersRun =
  | { state: 'done'; reads: number; failed: number; paused: number }
  | { state: 'failed'; code: string }

/**
 * One read by its kind: the website (ONB-101), the catalog (ONB-102),
 * what the brand already sent (ONB-103), its live ads (ONB-104) or what
 * customers say (ONB-105).
 */
export async function runSourceReadingJob(
  db: Db,
  job: Job,
  env?: NodeJS.ProcessEnv
): Promise<'read' | 'paused'> {
  if (job.kind === 'brand.read_catalog') {
    const reading = await runCatalogReadingJob(db, job, env)
    return reading.outcome
  }
  if (job.kind === 'brand.read_history') {
    const reading = await runHistoryReadingJob(db, job, env)
    return reading.outcome
  }
  if (job.kind === 'brand.read_ads') {
    await runAdsReadingJob(db, job, env)
    return 'read'
  }
  if (job.kind === 'brand.read_reviews') {
    await runReviewsReadingJob(db, job, env)
    return 'read'
  }
  await runSiteReadingJob(db, job, env)
  return 'read'
}

/**
 * The onboarding readers' run: the source reads waiting across the
 * workspaces (site, catalog, history, ads and reviews), one after another, as the worker. A read
 * is taken only while `readersRunMs` has not passed; each takes at most
 * `sourceRunMs`, so the run ends inside its route's 60 seconds. A read
 * that fails is recorded on its job (tried again later, at most four
 * tries); one Klaviyo paused is put back or stopped by its job; the run
 * goes on. It never throws.
 */
export async function runSourceReadings(
  db: Db,
  options: {
    env?: NodeJS.ProcessEnv
    budgetMs?: number
    now?: () => number
    read?: (db: Db, job: Job) => Promise<'read' | 'paused'>
    /** Rewrites a workspace's Brand book (ONB-106b) after its reads. */
    book?: (db: Db, tenantId: string) => Promise<unknown>
    /** The workspaces whose Brand book is older than their newest read. */
    staleBooks?: (db: Db) => Promise<string[]>
    /** The longest a Brand book write is waited for. */
    bookMs?: number
    /**
     * ONB-106c: the Brand strategist for one workspace, and the workspaces
     * whose newest book needs one. By default only when a live model is set
     * up for the plan tier (never the fake).
     */
    strategist?: (db: Db, tenantId: string) => Promise<unknown>
    strategyNeeded?: (db: Db) => Promise<string[]>
    /**
     * UI-BRAND-2: the Brand book rewrites the owner's clicks queued and
     * did not run at once (approve, a correction, Try again), each
     * started only while it still ends inside the reads' budget.
     */
    rewrites?: (db: Db, deadline: number) => Promise<unknown>
  } = {}
): Promise<ReadersRun> {
  const now = options.now ?? Date.now
  const started = now()
  const read =
    options.read ?? ((d: Db, j: Job) => runSourceReadingJob(d, j, options.env))
  const run = { state: 'done' as const, reads: 0, failed: 0, paused: 0 }
  const book = options.book ?? writeOnboardedBrandBook
  const waitMs = options.bookMs ?? bookMs
  // A Brand book write, waited for at most `waitMs`; a failure is logged
  // and never stops the run.
  const writeBook = (tenantId: string) =>
    within(book(db, tenantId), waitMs).catch((error: unknown) =>
      logger.warn('Brand book not written', {
        code: (error as { code?: string })?.code ?? 'brand_book_error'
      })
    )
  const env = options.env ?? process.env
  const strategist =
    options.strategist ??
    (strategistReady(env)
      ? (d: Db, t: string) => runBrandStrategist(d, t, { env })
      : null)
  // The strategist's call and its database work, with one more margin
  // kept free before the route's end.
  const fitsStrategist = () =>
    now() - started + strategistCallMs + 2 * dbMarginMs <= routeMs
  /**
   * ONB-106c: one Brand strategist call per run, for the newest book that
   * needs one (`booksNeedingStrategy`), only with a live plan model and only
   * when the lookup, the call (`strategistCallMs`) and the database margins
   * still end inside the route, checked again after the lookup. A failure
   * is logged, never thrown.
   */
  async function strategize() {
    if (!strategist) return
    if (!fitsStrategist()) return
    try {
      const [tenantId] = await (
        options.strategyNeeded ??
        ((d: Db) => booksNeedingStrategy(d, { limit: 1 }))
      )(db)
      if (!tenantId || !fitsStrategist()) return
      await within(strategist(db, tenantId), strategistCallMs + dbMarginMs)
    } catch (error) {
      const code = (error as { code?: string })?.code
      logger.warn('Brand strategist not run', {
        code:
          code === 'brand_book_timeout'
            ? 'brand_strategist_timeout'
            : (code ?? 'brand_strategist_error')
      })
    }
  }
  try {
    // First the rewrites the owner's clicks left waiting (UI-BRAND-2).
    await (
      options.rewrites ??
      ((d: Db, deadline: number) =>
        runBrandBookWrites(d, { limit: 5, deadline, now, ms: waitMs }))
    )(db, started + (options.budgetMs ?? readersRunMs))
    // Then the books a skipped or failed write left behind (the last two
    // days), only while reads may still start.
    const stale = await (
      options.staleBooks ??
      ((d: Db) =>
        staleBooks(d, {
          since: new Date(now() - 2 * 86_400_000).toISOString()
        }))
    )(db).catch(() => [] as string[])
    for (const tenantId of stale) {
      if (now() - started + waitMs >= (options.budgetMs ?? readersRunMs)) break
      await writeBook(tenantId)
    }
    while (now() - started < (options.budgetMs ?? readersRunMs)) {
      const claimed = await db.rpc('claim_source_reading')
      if (claimed.error) throw claimed.error
      const job = (claimed.data as Job[] | null)?.[0]
      if (!job) break
      try {
        if ((await read(db, job)) === 'paused') run.paused++
        else {
          run.reads++
          // What the readers found, put together right after a read (D19),
          // only when it still ends inside the route with the database
          // margin; otherwise the next read of the workspace writes it.
          if (now() - started + waitMs + dbMarginMs <= routeMs)
            await writeBook(job.tenant_id)
        }
      } catch (error) {
        run.failed++
        const failed = await db.rpc('fail_job', {
          job: job.id,
          lease: job.lease_token!,
          failure: classifyFailure(jobFailure(error))
        })
        if (failed.error)
          logger.warn('Source read failure not recorded', {
            code: failed.error.code ?? 'unknown'
          })
      }
    }
    await strategize()
    logger.info('Onboarding readers run finished', run)
    return run
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'readers_run_error'
    logger.error('Onboarding readers run failed', { code })
    return { state: 'failed', code }
  }
}
