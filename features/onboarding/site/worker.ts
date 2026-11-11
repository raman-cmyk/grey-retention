import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import type { Ask } from '@/features/intelligence/passes'
import type { FindingInput, SitePageKind } from '../findings'
import { homeUrl, type SiteFetcher } from './fetch'
import { pagesToRead, readPage, type ReadPage } from './pages'
import { readSitePage } from './reader'

type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']

/** The whole read, so it ends well inside the job's 90-second lease. */
export const siteRunMs = 30_000
/** Pages read at the same time. */
const parallelPages = 3

export type PageOutcome = {
  url: string
  kind: SitePageKind
  state: 'read' | 'skipped'
  /** Why a page was skipped (logged, D16). */
  reason?: string
  findings?: number
}

export type SiteRun = {
  pages: PageOutcome[]
  findings: number
  dropped: number
  live: boolean
}

/** Runs `work` on each item, a few at a time. */
async function inTurns<T, R>(
  items: T[],
  width: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await work(items[i]!, i)
      }
    })
  )
  return results
}

/**
 * The Site reader's job (ONB-101): reads the brand's own home page, finds
 * its shipping, returns, help, story and product pages from the home
 * page's links, reads each (a few at a time, each within the reader's
 * limits), asks the Site reader for the facts on each page, and stores
 * them all at once with the page each came from (`record_site_findings`,
 * which also finishes the job). A page that cannot be read in time, or at
 * all, is logged and skipped (D16). When no page could be read, nothing
 * earlier is replaced.
 */
export async function readBrandSite(
  db: Db,
  job: Job,
  deps: {
    fetcher: (domain: string) => SiteFetcher
    ask: Ask
    now?: () => number
  }
): Promise<SiteRun> {
  const now = deps.now ?? Date.now
  const deadline = now() + siteRunMs
  const brand = await db
    .from('brand_profiles')
    .select('brand_name')
    .eq('tenant_id', job.tenant_id)
    .single()
  if (brand.error || !brand.data) throw new Error('Brand unavailable')
  // The domain the job was started for, so a website changed mid-run
  // does not mix two sites.
  const domain = String(
    (job.input as { domain?: unknown } | null)?.domain ?? ''
  )
  const fetcher = deps.fetcher(domain)
  const run: SiteRun = {
    pages: [],
    findings: 0,
    dropped: 0,
    live: fetcher.live
  }
  const findings: (FindingInput & { pass: string; model: string | null })[] = []
  const skip = (url: string, kind: SitePageKind, reason: string) => {
    run.pages.push({ url, kind, state: 'skipped', reason })
    logger.info('Site page skipped', { kind, reason })
  }
  const read = async (
    page: ReadPage,
    n: number
  ): Promise<{ count: number } | { reason: string }> => {
    if (now() > deadline) return { reason: 'time_up' }
    const result = await readSitePage(
      { brand: brand.data.brand_name, page },
      deps.ask,
      `site-page:${page.kind}:${n}`
    )
    run.dropped += result.dropped
    for (const f of result.findings)
      findings.push({ ...f, pass: result.pass, model: result.model })
    if (!result.answered) return { reason: 'model_unusable' }
    return { count: result.findings.length }
  }
  const home = homeUrl(domain)
  if (!home) skip(`https://${domain || 'unknown'}/`, 'home', 'no_domain')
  else {
    const first = await fetcher.fetch(home)
    if (!first.ok) skip(home, 'home', first.failure)
    else {
      const homePage = readPage(first.html, first.url, 'home')
      const outcome = await read(homePage, 0)
      run.pages.push(
        'count' in outcome
          ? {
              url: homePage.url,
              kind: 'home',
              state: 'read',
              findings: outcome.count
            }
          : {
              url: homePage.url,
              kind: 'home',
              state: 'skipped',
              reason: outcome.reason
            }
      )
      const rest = pagesToRead(homePage, domain)
      const outcomes = await inTurns(rest, parallelPages, async (target, n) => {
        if (now() > deadline) return { ...target, reason: 'time_up' }
        const fetched = await fetcher.fetch(target.url)
        if (!fetched.ok) return { ...target, reason: fetched.failure }
        const outcome = await read(
          readPage(fetched.html, fetched.url, target.kind),
          n + 1
        )
        return 'count' in outcome
          ? { ...target, count: outcome.count }
          : { ...target, reason: outcome.reason }
      })
      for (const o of outcomes)
        if ('count' in o)
          run.pages.push({
            url: o.url,
            kind: o.kind,
            state: 'read',
            findings: o.count
          })
        else skip(o.url, o.kind, o.reason)
    }
  }
  // A fact repeated on every page (a footer line) is kept once: the first
  // page it was read on.
  const seen = new Set<string>()
  const unique = findings.filter((f) => {
    const quote = 'quote' in f.evidence ? f.evidence.quote : ''
    const key = `${f.topic}:${quote.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  run.findings = unique.length
  const recorded = await db.rpc('record_site_findings', {
    job: job.id,
    lease: job.lease_token!,
    findings: unique.map((f) => ({
      topic: f.topic,
      statement: f.statement,
      value: f.value,
      evidence: f.evidence,
      confidence: f.confidence,
      pass: f.pass,
      model: f.model
    })) as unknown as Json,
    pages: run.pages as unknown as Json,
    live: run.live
  })
  if (recorded.error) throw recorded.error
  logger.info('Site read', {
    pages: run.pages.length,
    read: run.pages.filter((p) => p.state === 'read').length,
    findings: run.findings,
    dropped: run.dropped,
    live: run.live
  })
  return run
}
