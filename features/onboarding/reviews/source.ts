import 'server-only'
import {
  maxReviews,
  sampleReviewSource,
  type PlatformRating,
  type ReadReview,
  type ReviewSource
} from '@/lib/providers/review-source'
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
 * The brand's reviews from its own product pages (the review data they
 * publish): the catalog's product pages first (bestsellers first), else
 * those the home page links to. Every page is fetched by the site reader
 * (https on the brand's own host only, ONB-101), none started without
 * time for it; a page that cannot be read is skipped. When no page could
 * be read, the source is unavailable (the read is tried again).
 */
export function siteReviewSource(
  fetcher: SiteFetcher,
  domain: string,
  productUrls: string[],
  time: { now: () => number; deadline: number }
): ReviewSource {
  return {
    live: fetcher.live,
    async reviews() {
      let urls = productUrls.slice(0, maxReviewPages)
      if (!urls.length) {
        const home = homeUrl(domain)
        const first = home ? await fetcher.fetch(home) : null
        if (!first?.ok) return { ok: false, code: 'unavailable' }
        urls = pagesToRead(readPage(first.html, first.url, 'home'), domain)
          .filter((p) => p.kind === 'product')
          .map((p) => p.url)
          .slice(0, maxReviewPages)
      }
      const read: { at: number; url: string; html: string }[] = []
      let next = 0
      await Promise.all(
        Array.from(
          { length: Math.min(parallelPages, urls.length) },
          async () => {
            while (next < urls.length) {
              const at = next++
              if (time.now() + pageTimeoutMs > time.deadline) return
              const page = await fetcher.fetch(urls[at]!)
              if (page.ok) read.push({ at, url: page.url, html: page.html })
            }
          }
        )
      )
      if (!read.length) return { ok: false, code: 'unavailable' }
      // In the order asked for, so a read's ids do not depend on timing.
      read.sort((a, b) => a.at - b.at)
      const reviews: ReadReview[] = []
      const platforms: PlatformRating[] = []
      for (const page of read) {
        const found = pageReviews(page.html, page.url)
        for (const r of found.reviews)
          if (reviews.length < maxReviews)
            reviews.push({ ...r, id: `r${reviews.length + 1}` })
        if (
          found.platform &&
          !platforms.some((p) => p.name === found.platform!.name)
        )
          platforms.push(found.platform)
      }
      return { ok: true, reviews, platforms, pages: read.map((p) => p.url) }
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
