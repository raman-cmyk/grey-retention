import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { ProviderFault } from '@/features/integrations/failures'
import type { Ask } from '@/features/intelligence/passes'
import {
  ownAds,
  type AdLibrary,
  type AdLibraryAnswer
} from '@/lib/providers/ad-library'
import { analyseAds, countedAdFindings, type AdFinding } from './analyst'

type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']

/** The whole read, so it ends well inside the job's 90-second lease. */
export const adsRunMs = 25_000
/** The longest the Ad Library may take to answer. */
export const libraryMs = 10_000
/** Tries a job has (the readers' run fails it after the fourth). */
const lastTry = 4

export type AdsRun = {
  /**
   * `ready`: the brand's live ads were read; `none`: the library has no
   * live ads for it (its earlier ads findings are replaced); `skipped`: no
   * library could read them, or none of the ads found is the brand's own
   * page (nothing is replaced, D16).
   */
  state: 'ready' | 'none' | 'skipped'
  reason?: string
  ads: number
  findings: number
  dropped: number
  /** Whether the analyst's words are in (the counted findings always are). */
  analysis: 'done' | 'skipped'
  live: boolean
}

/**
 * The library's answer; an outage when it takes too long (the request is
 * aborted) or fails instead of answering.
 */
async function inTime(
  ask: (signal: AbortSignal) => Promise<AdLibraryAnswer>,
  ms: number
): Promise<AdLibraryAnswer> {
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => ask(abort.signal))
        .catch((): AdLibraryAnswer => ({
          ok: false,
          code: 'unavailable'
        })),
      new Promise<AdLibraryAnswer>((resolve) => {
        timer = setTimeout(() => {
          abort.abort()
          resolve({ ok: false, code: 'unavailable' })
        }, ms)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The Ads analyst's job (ONB-104): asks the Ad Library for the brand's
 * active ads, keeps the brand's own (`ownAds`: its own page, at most 30,
 * texts capped), counts their landing pages and formats, asks the Ads
 * analyst what they offer and say, and stores it all at once with the ads
 * read (`record_ad_findings`, which also finishes the job). No ads, a
 * library that cannot read this brand, or ads of no page that is the
 * brand's, is logged and skipped (D16); an outage or a rate limit fails
 * the job for another try (earlier findings stay), and on its last try the
 * read is logged and skipped instead.
 */
export async function readBrandAds(
  db: Db,
  job: Job,
  deps: {
    library: (mode: 'sample' | 'live') => AdLibrary
    /**
     * How to ask the Ads analyst: the sample rules for sample ads; a model
     * for live ones, or null when no model is set up (then only the
     * counted findings are stored).
     */
    askFor: (live: boolean) => Ask | null
    /** Time one model call may take; none is started with less left. */
    callMs?: number
    now?: () => number
  }
): Promise<AdsRun> {
  const now = deps.now ?? Date.now
  const deadline = now() + adsRunMs
  const callMs = deps.callMs ?? 0
  const brand = await db
    .from('brand_profiles')
    .select('brand_name')
    .eq('tenant_id', job.tenant_id)
    .single()
  if (brand.error || !brand.data) throw new Error('Brand unavailable')
  // The domain the job was started for, so a website changed mid-run
  // does not mix two brands.
  const input = (job.input ?? {}) as { domain?: unknown; mode?: unknown }
  const domain = String(input.domain ?? '')
  // The library of the read's own mode (a synthetic brand's sample ads,
  // or a real brand's live ones), whatever its domain looks like.
  const library = deps.library(input.mode === 'live' ? 'live' : 'sample')
  const run: AdsRun = {
    state: 'skipped',
    ads: 0,
    findings: 0,
    dropped: 0,
    analysis: 'skipped',
    live: library.live
  }
  let ads: ReturnType<typeof ownAds> = []
  let findings: (AdFinding & { pass: string; model: string | null })[] = []
  const answer = await inTime(
    (signal) =>
      library.activeAds({ brandName: brand.data.brand_name, domain, signal }),
    Math.min(libraryMs, Math.max(0, deadline - now()))
  )
  const retrying =
    !answer.ok &&
    (answer.code === 'unavailable' || answer.code === 'rate_limited')
  if (!answer.ok && retrying && (job.attempt ?? 0) < lastTry) {
    logger.warn('Ad Library unavailable; the read is tried again', {
      code: answer.code
    })
    throw new ProviderFault(
      answer.code === 'rate_limited' ? 'rate_limit' : 'transient'
    )
  }
  if (!answer.ok) {
    run.reason = retrying
      ? 'library_unavailable'
      : answer.code === 'not_set_up'
        ? 'library_not_set_up'
        : 'library_refused'
    logger.info('Ads read skipped', { reason: run.reason })
  } else if (!answer.ads.some((ad) => ad.active)) {
    run.state = 'none'
    logger.info('Ads read: the brand runs no live ads')
  } else {
    ads = ownAds(answer.ads, domain, brand.data.brand_name)
    run.ads = ads.length
    if (!ads.length) {
      run.reason = 'no_own_page'
      logger.info('Ads read skipped', { reason: run.reason })
    } else {
      run.state = 'ready'
      const counted = countedAdFindings(ads)
      const pass = library.live ? 'code' : 'sample'
      findings = counted.map((f) => ({ ...f, pass, model: null }))
      const ask = deps.askFor(library.live)
      if (!ask) logger.info('Ads analyst not asked', { reason: 'no_model' })
      else if (now() + callMs > deadline)
        logger.info('Ads analyst not asked', { reason: 'time_up' })
      else {
        const analysis = await analyseAds(
          brand.data.brand_name,
          ads,
          ask,
          `ads:${job.id}`
        )
        if (!analysis.answered)
          logger.info('Ads analyst answer left out', {
            reason: analysis.reason
          })
        else {
          run.analysis = 'done'
          run.dropped = analysis.dropped
          const said = new Set(
            findings.map(
              (f) =>
                `${f.topic}:${'quote' in f.evidence ? f.evidence.quote.toLowerCase() : ''}`
            )
          )
          for (const f of analysis.findings) {
            const key = `${f.topic}:${'quote' in f.evidence ? f.evidence.quote.toLowerCase() : ''}`
            if (said.has(key)) continue
            said.add(key)
            findings.push({ ...f, pass: analysis.pass, model: analysis.model })
          }
        }
      }
    }
  }
  run.findings = findings.length
  const recorded = await db.rpc('record_ad_findings', {
    job: job.id,
    lease: job.lease_token!,
    findings: findings.map((f) => ({
      topic: f.topic,
      statement: f.statement,
      value: f.value,
      evidence: f.evidence,
      confidence: f.confidence,
      pass: f.pass,
      model: f.model
    })) as unknown as Json,
    ads: ads.map((ad) => ({ id: ad.id, link: ad.linkUrl })) as unknown as Json,
    summary: {
      state: run.state,
      analysis: run.analysis,
      ...(run.reason ? { reason: run.reason } : {})
    } as unknown as Json,
    live: run.live
  })
  if (recorded.error) throw recorded.error
  logger.info('Ads read', {
    state: run.state,
    ads: run.ads,
    findings: run.findings,
    dropped: run.dropped,
    analysis: run.analysis,
    live: run.live
  })
  return run
}
