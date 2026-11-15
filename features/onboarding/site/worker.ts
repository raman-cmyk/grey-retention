import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import type { Ask } from '@/features/intelligence/passes'
import type { FindingInput, SitePageKind } from '../findings'
import {
  homeUrl,
  logoTimeoutMs,
  pageTimeoutMs,
  type SiteFetcher
} from './fetch'
import { logoCandidates, logoTone, pickLogos } from './logos'
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
  /** Which logos were kept (ONB-060b); absent when none were looked for. */
  logos?: { onLight: boolean; onDark: boolean }
}

export type PickedLogos = { onLight: string | null; onDark: string | null }

/** Longest logo address kept (the database refuses longer ones). */
const maxLogoUrl = 1_000

/**
 * The brand's logos on its home page (ONB-060b): each candidate's picture
 * read (all at once, each within `logoTimeoutMs`, none started without
 * that time left) and its ink measured, then the pick for light and for
 * dark sections. A picture that cannot be read counts as unknown ink;
 * this never fails.
 */
export async function findLogos(
  page: { html: string; url: string },
  brand: string,
  picture: (url: string) => Promise<Uint8Array | null>,
  { now, deadline }: { now: () => number; deadline: number }
): Promise<PickedLogos> {
  try {
    const found = await Promise.all(
      logoCandidates(page.html, page.url, { brand }).map(async (candidate) => {
        if (now() + logoTimeoutMs > deadline) return { candidate, tone: null }
        const bytes = await picture(candidate.url).catch(() => null)
        return { candidate, tone: bytes ? logoTone(bytes) : null }
      })
    )
    const { onLight, onDark } = pickLogos(found)
    const fits = (url: string | null) =>
      url && url.length <= maxLogoUrl ? url : null
    return { onLight: fits(onLight), onDark: fits(onDark) }
  } catch (error) {
    logger.warn('Site logos unreadable', {
      error: error instanceof Error ? error.name : 'unknown'
    })
    return { onLight: null, onDark: null }
  }
}

/**
 * Runs `work` on each item, a few at a time. After a failure no new item is
 * started (the job fails and is tried again; nothing more is paid for).
 */
async function inTurns<T, R>(
  items: T[],
  width: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  let failed = false
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length && !failed) {
        const i = next++
        try {
          results[i] = await work(items[i]!, i)
        } catch (error) {
          failed = true
          throw error
        }
      }
    })
  )
  return results
}

/** Longest page address kept (the database refuses longer ones). */
const maxUrl = 500

/**
 * The Site reader's job (ONB-101): reads the brand's own home page, finds
 * its shipping, returns, help, story and product pages from the home
 * page's links, reads each (a few at a time, each within the reader's
 * limits), asks the Site reader for the facts on each page, and stores
 * them all at once with the page each came from (`record_site_findings`,
 * which also finishes the job). A page that cannot be read in time, or at
 * all, is logged and skipped (D16). When no page could be read, nothing
 * earlier is replaced. A live read also keeps the logos of the home page
 * (ONB-060b, `record_site_logos`, before the findings); logos that cannot
 * be kept are logged, and the emails show the brand's name instead.
 */
export async function readBrandSite(
  db: Db,
  job: Job,
  deps: {
    fetcher: (domain: string) => SiteFetcher
    /**
     * How to ask the Site reader for a site: the sample rules for the
     * sample site; a model for a live one, or null when no model is set up
     * (then a live site is not read: no fact is guessed from a real page).
     */
    askFor: (live: boolean) => Ask | null
    /** Time one model call may take; none is started with less left. */
    callMs?: number
    now?: () => number
  }
): Promise<SiteRun> {
  const now = deps.now ?? Date.now
  const deadline = now() + siteRunMs
  const callMs = deps.callMs ?? 0
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
  const ask = deps.askFor(fetcher.live)
  const run: SiteRun = {
    pages: [],
    findings: 0,
    dropped: 0,
    live: fetcher.live
  }
  // Each page's findings in page order, so a repeated fact cites the first.
  const byPage: (FindingInput & { pass: string; model: string | null })[][] = []
  const skip = (url: string, kind: SitePageKind, reason: string) => {
    run.pages.push({
      url: url.slice(0, maxUrl),
      kind,
      state: 'skipped',
      reason
    })
    logger.info('Site page skipped', { kind, reason })
  }
  const read = async (
    page: ReadPage,
    n: number
  ): Promise<{ count: number } | { reason: string }> => {
    if (page.url.length > maxUrl) return { reason: 'url_too_long' }
    if (!ask) return { reason: 'no_model' }
    if (now() + callMs > deadline) return { reason: 'time_up' }
    const result = await readSitePage(
      { brand: brand.data.brand_name, page },
      ask,
      `site-page:${page.kind}:${n}`
    )
    if (!result.answered) return { reason: result.reason }
    run.dropped += result.dropped
    byPage[n] = result.findings.map((f) => ({
      ...f,
      pass: result.pass,
      model: result.model
    }))
    return { count: result.findings.length }
  }
  let logos: Promise<PickedLogos> | null = null
  const home = homeUrl(domain)
  if (!home) skip(`https://${domain || 'unknown'}/`, 'home', 'no_domain')
  else if (!ask) skip(home, 'home', 'no_model')
  else {
    const first = await fetcher.fetch(home)
    if (!first.ok) skip(home, 'home', first.failure)
    else {
      const homePage = readPage(first.html, first.url, 'home')
      // The logos are looked for while the other pages are read.
      const picture = fetcher.picture?.bind(fetcher)
      if (fetcher.live && picture)
        logos = findLogos(first, brand.data.brand_name, picture, {
          now,
          deadline
        })
      const outcome = await read(homePage, 0)
      if ('count' in outcome)
        run.pages.push({
          url: homePage.url,
          kind: 'home',
          state: 'read',
          findings: outcome.count
        })
      else skip(homePage.url, 'home', outcome.reason)
      const rest = pagesToRead(homePage, domain)
      const outcomes = await inTurns(rest, parallelPages, async (target, n) => {
        // A page is fetched only with time for its fetch and one model call,
        // so every page the run starts ends by its deadline.
        if (now() + pageTimeoutMs + callMs > deadline)
          return { ...target, reason: 'time_up' }
        const fetched = await fetcher.fetch(target.url)
        if (!fetched.ok) return { ...target, reason: fetched.failure }
        const outcome = await read(
          readPage(fetched.html, fetched.url, target.kind),
          n + 1
        )
        return 'count' in outcome
          ? { ...target, url: fetched.url, count: outcome.count }
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
  const unique = byPage.flat().filter((f) => {
    const quote = 'quote' in f.evidence ? f.evidence.quote : ''
    const key = `${f.topic}:${quote.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  run.findings = unique.length
  const picked = logos ? await logos : null
  if (picked) {
    const kept = await db.rpc('record_site_logos', {
      job: job.id,
      lease: job.lease_token!,
      on_light: picked.onLight ?? undefined,
      on_dark: picked.onDark ?? undefined
    })
    if (kept.error)
      logger.warn('Site logos not kept', { code: kept.error.code })
    // False: a newer read of the site already kept its own.
    else if (kept.data === true)
      run.logos = { onLight: !!picked.onLight, onDark: !!picked.onDark }
  }
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
    live: run.live,
    logoOnLight: run.logos?.onLight ?? null,
    logoOnDark: run.logos?.onDark ?? null
  })
  return run
}
