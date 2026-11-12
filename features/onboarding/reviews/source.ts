import 'server-only'
import {
  maxReviews,
  sampleReviewSource,
  type PlatformRating,
  type ReadReview,
  type ReviewSource
} from '@/lib/providers/review-source'
import { onDomain } from '@/lib/providers/ad-library'
import {
  homeUrl,
  liveSiteFetcher,
  pageTimeoutMs,
  type SiteFetcher
} from '../site/fetch'
import { pagesToRead, readPage } from '../site/pages'
import { pageReviews } from './jsonld'

/** Product pages one read asks for reviews, read this many at a time. */
export const maxReviewPages = 6
const parallelPages = 3

/**
 * A page address the database keeps: https on the brand's own domain (or
 * a subdomain) with plain labels, at most 500 characters.
 */
export function pageOk(url: string, domain: string): boolean {
  if (url.length > 500) return false
  try {
    const u = new URL(url)
    return (
      u.protocol === 'https:' &&
      !u.port &&
      !u.username &&
      !u.password &&
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
        u.hostname
      ) &&
      onDomain(u.hostname, domain)
    )
  } catch {
    return false
  }
}

type Read = { url: string; html: string }

/** Pages fetched a few at a time, in the order asked, none started without time. */
async function fetchAll(
  fetcher: SiteFetcher,
  urls: string[],
  time: { now: () => number; deadline: number },
  signal?: AbortSignal
): Promise<{ read: Read[]; missed: number }> {
  const read: (Read & { at: number })[] = []
  let next = 0
  let missed = 0
  await Promise.all(
    Array.from({ length: Math.min(parallelPages, urls.length) }, async () => {
      while (next < urls.length) {
        const at = next++
        if (signal?.aborted || time.now() + pageTimeoutMs > time.deadline) {
          missed++
          continue
        }
        const page = await fetcher.fetch(urls[at]!)
        if (page.ok) read.push({ at, url: page.url, html: page.html })
        else missed++
      }
    })
  )
  // In the order asked for, so a read's ids do not depend on timing.
  read.sort((a, b) => a.at - b.at)
  return { read, missed }
}

/**
 * The brand's reviews from its own product pages (the review data they
 * publish): the catalog's product pages first (bestsellers first), else,
 * when the catalog has none or none can be read, those the home page
 * links to. Every page is fetched by the site reader (https on the brand's
 * own host only, ONB-101), none started without time for it; a page that
 * cannot be read is skipped, and each page reached is kept once (two
 * addresses may lead to one page). No product page found is `no_pages`;
 * no page read at all is `unavailable` (the read is tried again).
 */
export function siteReviewSource(
  fetcher: SiteFetcher,
  domain: string,
  productUrls: string[],
  time: { now: () => number; deadline: number }
): ReviewSource {
  return {
    live: fetcher.live,
    async reviews(query) {
      const signal = query.signal
      let urls = productUrls
        .filter((u) => pageOk(u, domain))
        .slice(0, maxReviewPages)
      let { read, missed } = urls.length
        ? await fetchAll(fetcher, urls, time, signal)
        : { read: [] as Read[], missed: 0 }
      if (!read.length) {
        const home = homeUrl(domain)
        const first =
          home &&
          !signal?.aborted &&
          time.now() + pageTimeoutMs <= time.deadline
            ? await fetcher.fetch(home)
            : null
        if (!first?.ok) return { ok: false, code: 'unavailable' }
        urls = pagesToRead(readPage(first.html, first.url, 'home'), domain)
          .filter((p) => p.kind === 'product')
          .map((p) => p.url)
          .filter((u) => pageOk(u, domain))
          .slice(0, maxReviewPages)
        if (!urls.length) return { ok: false, code: 'no_pages' }
        ;({ read, missed } = await fetchAll(fetcher, urls, time, signal))
        if (!read.length) return { ok: false, code: 'unavailable' }
      }
      const pages: string[] = []
      const reviews: ReadReview[] = []
      const platforms: PlatformRating[] = []
      const said = new Set<string>()
      for (const page of read) {
        if (!pageOk(page.url, domain) || pages.includes(page.url)) continue
        pages.push(page.url)
        const found = pageReviews(page.html, page.url)
        for (const r of found.reviews) {
          // A review shown on every page (a shop-wide carousel) is one review.
          const key = `${r.author.toLowerCase()}\n${r.text.toLowerCase()}`
          if (said.has(key) || reviews.length >= maxReviews) continue
          said.add(key)
          reviews.push({ ...r, id: `r${reviews.length + 1}` })
        }
        if (
          found.platform &&
          !platforms.some((p) => p.name === found.platform!.name)
        )
          platforms.push(found.platform)
      }
      return { ok: true, reviews, platforms, pages, complete: missed === 0 }
    }
  }
}

/**
 * The review source a read uses, by its mode: the sample for a synthetic
 * brand; a real brand's own product pages only with the owner's
 * `SITE_READER_MODE=live`, else none (`not_set_up`).
 */
export function reviewSourceFor(
  mode: 'sample' | 'live',
  domain: string,
  productUrls: string[],
  time: { now: () => number; deadline: number },
  env: NodeJS.ProcessEnv = process.env
): ReviewSource {
  if (mode === 'sample') return sampleReviewSource
  if (env.SITE_READER_MODE !== 'live')
    return {
      live: true,
      async reviews() {
        return { ok: false, code: 'not_set_up' }
      }
    }
  return siteReviewSource(liveSiteFetcher(domain), domain, productUrls, time)
}
