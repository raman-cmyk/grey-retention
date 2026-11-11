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

export type AdsRun = {
  /**
   * `ready`: the brand's live ads were read; `none`: it runs none (its
   * earlier ads findings are replaced); `skipped`: no library could read
   * them (nothing is replaced, D16).
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

/** The library's answer, or an outage when it takes too long. */
async function inTime(
  answer: Promise<AdLibraryAnswer>,
  ms: number
): Promise<AdLibraryAnswer> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      answer,
      new Promise<AdLibraryAnswer>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, code: 'unavailable' }),
          ms
        )
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
 * read (`record_ad_findings`, which also finishes the job). No ads, or a
 * library that cannot read this brand, is logged and skipped (D16); an
 * outage or a rate limit fails the job for another try (earlier findings
 * stay).
 */
export async function readBrandAds(
  db: Db,
  job: Job,
  deps: {
    library: (domain: string) => AdLibrary
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
  const domain = String(
    (job.input as { domain?: unknown } | null)?.domain ?? ''
  )
  const library = deps.library(domain)
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
    library.activeAds({ brandName: brand.data.brand_name, domain }),
    Math.min(libraryMs, Math.max(0, deadline - now()))
  )
  if (!answer.ok) {
    if (answer.code === 'unavailable' || answer.code === 'rate_limited') {
      logger.warn('Ad Library unavailable; the read is tried again', {
        code: answer.code
      })
      throw new ProviderFault(
        answer.code === 'rate_limited' ? 'rate_limit' : 'transient'
      )
    }
    run.reason =
      answer.code === 'not_set_up' ? 'library_not_set_up' : 'library_refused'
    logger.info('Ads read skipped', { reason: run.reason })
  } else {
    ads = ownAds(answer.ads, domain)
    run.ads = ads.length
    if (!ads.length) {
      run.state = 'none'
      logger.info('Ads read: the brand runs no live ads')
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
          'ads-read'
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
