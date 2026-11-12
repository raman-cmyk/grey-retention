import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { ProviderFault } from '@/features/integrations/failures'
import type { Ask } from '@/features/intelligence/passes'
import {
  maxComments,
  type ReadReview,
  type ReviewAnswer,
  type ReviewSource,
  type SocialAnswer,
  type SocialComment,
  type SocialSource
} from '@/lib/providers/review-source'
import { maxReviewPages } from './source'
import {
  analyseCustomers,
  platformFindings,
  quotableReviews,
  type CustomerFinding
} from './reader'

type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']

/** The whole read, so it ends well inside the job's 90-second lease. */
export const reviewsRunMs = 30_000
/** The longest the review pages, and the social source, may take. */
export const reviewsSourceMs = 15_000
export const socialSourceMs = 10_000
/** Tries a job has (the readers' run fails it after the fourth). */
const lastTry = 4

export type SourceState = {
  /**
   * `ready`: read, with findings; `none`: read, nothing there (its earlier
   * findings are replaced); `skipped`: not read (nothing replaced, D16).
   */
  state: 'ready' | 'none' | 'skipped'
  reason?: string
}

export type ReviewsRun = {
  reviews: SourceState
  social: SourceState
  read: { reviews: number; comments: number; pages: number }
  findings: number
  dropped: number
  analysis: 'done' | 'skipped'
  live: boolean
}

/** An answer, or `unavailable` when it takes too long or fails. */
async function inTime<A>(
  ask: (signal: AbortSignal) => Promise<A>,
  ms: number,
  unavailable: A
): Promise<A> {
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => ask(abort.signal))
        .catch(() => unavailable),
      new Promise<A>((resolve) => {
        timer = setTimeout(() => {
          abort.abort()
          resolve(unavailable)
        }, ms)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** The brand's own product pages in the catalog, bestsellers first. */
async function catalogPages(db: Db, tenantId: string): Promise<string[]> {
  const { data, error } = await db
    .from('products')
    .select('url')
    .eq('tenant_id', tenantId)
    .not('url', 'is', null)
    .order('units_90d', { ascending: false, nullsFirst: false })
    .limit(maxReviewPages * 2)
  if (error) return []
  return [
    ...new Set(
      (data ?? [])
        .map((p) => p.url)
        .filter(
          (u): u is string => typeof u === 'string' && u.startsWith('https://')
        )
    )
  ].slice(0, maxReviewPages)
}

/**
 * The Reviews + social reader's job (ONB-105): reads the reviews on the
 * brand's own product pages and the comments on its public posts, chooses
 * by code the reviews an email may quote (real, with their author, source
 * and exact words) and the review apps shown, asks the reader what
 * customers love, worry about and say, and stores it all at once
 * (`record_review_findings`, which also finishes the job). A source that
 * cannot read this brand is logged and skipped (D16); an outage fails the
 * job for another try, and on its last try that source is skipped.
 */
export async function readBrandReviews(
  db: Db,
  job: Job,
  deps: {
    reviews: (
      mode: 'sample' | 'live',
      domain: string,
      productUrls: string[],
      time: { now: () => number; deadline: number }
    ) => ReviewSource
    social: (mode: 'sample' | 'live') => SocialSource
    askFor: (live: boolean) => Ask | null
    callMs?: number
    now?: () => number
  }
): Promise<ReviewsRun> {
  const now = deps.now ?? Date.now
  const deadline = now() + reviewsRunMs
  const callMs = deps.callMs ?? 0
  const brand = await db
    .from('brand_profiles')
    .select('brand_name')
    .eq('tenant_id', job.tenant_id)
    .single()
  if (brand.error || !brand.data) throw new Error('Brand unavailable')
  const input = (job.input ?? {}) as { domain?: unknown; mode?: unknown }
  const domain = String(input.domain ?? '')
  const mode = input.mode === 'live' ? 'live' : 'sample'
  const query = { brandName: brand.data.brand_name, domain }
  const reviewSource = deps.reviews(
    mode,
    domain,
    mode === 'live' ? await catalogPages(db, job.tenant_id) : [],
    { now, deadline: now() + reviewsSourceMs }
  )
  const socialSource = deps.social(mode)
  const [reviewed, commented] = await Promise.all([
    inTime<ReviewAnswer>(
      (signal) => reviewSource.reviews({ ...query, signal }),
      reviewsSourceMs,
      { ok: false, code: 'unavailable' }
    ),
    inTime<SocialAnswer>(
      (signal) => socialSource.comments({ ...query, signal }),
      socialSourceMs,
      { ok: false, code: 'unavailable' }
    )
  ])
  const unwell = [reviewed, commented].some(
    (a) => !a.ok && a.code === 'unavailable'
  )
  if (unwell && (job.attempt ?? 0) < lastTry) {
    logger.warn('Reviews or social unavailable; the read is tried again')
    throw new ProviderFault('transient')
  }
  const skipped = (code: string, what: string): SourceState => ({
    state: 'skipped',
    reason: `${what}_${code === 'unavailable' ? 'unavailable' : 'not_set_up'}`
  })
  const reviews: ReadReview[] = reviewed.ok ? reviewed.reviews : []
  const comments: SocialComment[] = commented.ok
    ? commented.comments.slice(0, maxComments)
    : []
  const pages = reviewed.ok ? reviewed.pages : []
  const run: ReviewsRun = {
    reviews: reviewed.ok
      ? {
          state: reviews.length || reviewed.platforms.length ? 'ready' : 'none'
        }
      : skipped(reviewed.code, 'reviews'),
    social: commented.ok
      ? { state: comments.length ? 'ready' : 'none' }
      : skipped(commented.code, 'social'),
    read: {
      reviews: reviews.length,
      comments: comments.length,
      pages: pages.length
    },
    findings: 0,
    dropped: 0,
    analysis: 'skipped',
    live: mode === 'live'
  }
  const pass = run.live ? 'code' : 'sample'
  const findings: (CustomerFinding & { pass: string; model: string | null })[] =
    [
      ...quotableReviews(reviews),
      ...platformFindings(reviewed.ok ? reviewed.platforms : [])
    ].map((f) => ({ ...f, pass, model: null }))
  if (reviews.length || comments.length) {
    const ask = deps.askFor(run.live)
    if (!ask) logger.info('Reviews reader not asked', { reason: 'no_model' })
    else if (now() + callMs > deadline)
      logger.info('Reviews reader not asked', { reason: 'time_up' })
    else {
      const analysis = await analyseCustomers(
        brand.data.brand_name,
        reviews,
        comments,
        ask,
        `reviews:${job.id}`
      )
      if (!analysis.answered)
        logger.info('Reviews reader answer left out', {
          reason: analysis.reason
        })
      else {
        run.analysis = 'done'
        run.dropped = analysis.dropped
        for (const f of analysis.findings)
          findings.push({ ...f, pass: analysis.pass, model: analysis.model })
      }
    }
  }
  // A source read with nothing to say is none: its earlier findings go.
  for (const source of ['reviews', 'social'] as const)
    if (
      run[source].state === 'ready' &&
      !findings.some((f) => f.source === source)
    )
      run[source] = { state: 'none' }
  run.findings = findings.length
  const recorded = await db.rpc('record_review_findings', {
    job: job.id,
    lease: job.lease_token!,
    findings: findings.map((f) => ({
      source: f.source,
      topic: f.topic,
      statement: f.statement,
      value: f.value,
      evidence: f.evidence,
      confidence: f.confidence,
      pass: f.pass,
      model: f.model
    })) as unknown as Json,
    pages: pages as unknown as Json,
    posts: [...new Set(comments.map((c) => c.url))] as unknown as Json,
    summary: {
      reviews: run.reviews,
      social: run.social,
      analysis: run.analysis
    } as unknown as Json,
    live: run.live
  })
  if (recorded.error) throw recorded.error
  logger.info('Reviews read', {
    reviews: run.reviews.state,
    social: run.social.state,
    read: run.read.reviews,
    comments: run.read.comments,
    findings: run.findings,
    dropped: run.dropped,
    analysis: run.analysis,
    live: run.live
  })
  return run
}
