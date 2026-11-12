// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { sampleReviewSource } from '@/lib/providers/review-source'
import type { SiteFetcher, SitePageResult } from '../site/fetch'
import { maxReviewPages, reviewSourceFor, siteReviewSource } from './source'

const domain = 'cedar-lane.example'
const product = (n: number) => `https://${domain}/products/p${n}`
const withReview = (author: string) =>
  `<html><script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    name: author,
    review: [{ author, reviewBody: `Lovely, says ${author}.` }]
  })}</script></html>`
function fetcher(
  pages: Record<string, string | null>,
  delays: Record<string, number> = {},
  /** Where an address leads (a redirect). */
  leads: Record<string, string> = {}
) {
  const asked: string[] = []
  const site: SiteFetcher = {
    live: true,
    async fetch(url): Promise<SitePageResult> {
      asked.push(url)
      if (delays[url]) await new Promise((r) => setTimeout(r, delays[url]))
      const html = pages[url]
      return html
        ? { ok: true, url: leads[url] ?? url, html }
        : { ok: false, failure: 'not_found' }
    }
  }
  return { site, asked }
}
const ask = { brandName: 'C', domain }
const time = { now: () => 0, deadline: 60_000 }
const env = (vars: Record<string, string>) =>
  vars as unknown as NodeJS.ProcessEnv

describe('the reviews on the brand’s own product pages', () => {
  it('reads the catalog’s pages, at most six, in the order asked, skipping one it cannot read', async () => {
    const urls = Array.from({ length: 8 }, (_, n) => product(n + 1))
    const { site, asked } = fetcher(
      Object.fromEntries(
        urls.map((u, n) => [u, n === 1 ? null : withReview(`A${n + 1}`)])
      ),
      { [product(1)]: 20 }
    )
    const answer = await siteReviewSource(site, domain, urls, time).reviews({
      brandName: 'C',
      domain
    })
    expect(asked).toHaveLength(maxReviewPages)
    expect(answer.ok && answer.reviews.map((r) => [r.id, r.author])).toEqual([
      ['r1', 'A1'],
      ['r2', 'A3'],
      ['r3', 'A4'],
      ['r4', 'A5'],
      ['r5', 'A6']
    ])
    expect(answer.ok && answer.pages).toHaveLength(5)
    // A page missed: the read is not complete.
    expect(answer.ok && answer.complete).toBe(false)
  })

  it('is complete when every page asked for is read', async () => {
    const { site } = fetcher({ [product(1)]: '<html></html>' })
    expect(
      await siteReviewSource(site, domain, [product(1)], time).reviews(ask)
    ).toEqual({
      ok: true,
      reviews: [],
      platforms: [],
      pages: [product(1)],
      complete: true
    })
  })

  it('asks only the brand’s own https pages', async () => {
    const own = product(1)
    const { site, asked } = fetcher({ [own]: withReview('A') })
    await siteReviewSource(
      site,
      domain,
      [
        'http://cedar-lane.example/products/a',
        'https://cedar-lane.example:8443/products/b',
        'https://evil.example/products/c',
        'https://user:pw@cedar-lane.example/products/d',
        `https://${domain}/${'x'.repeat(500)}`,
        own
      ],
      time
    ).reviews(ask)
    expect(asked).toEqual([own])
  })

  it('keeps each page reached once, and a review shown on every page once', async () => {
    const { site } = fetcher(
      {
        [product(1)]: withReview('A'),
        [product(2)]: withReview('A'),
        [product(3)]: withReview('A')
      },
      {},
      // Two addresses that lead to one page; one that leads off the site.
      { [product(2)]: product(1), [product(3)]: 'https://evil.example/p' }
    )
    const answer = await siteReviewSource(
      site,
      domain,
      [product(1), product(2), product(3)],
      time
    ).reviews(ask)
    expect(answer.ok && answer.pages).toEqual([product(1)])
    expect(answer.ok && answer.reviews.map((r) => r.author)).toEqual(['A'])
  })

  it('names each review app once', async () => {
    const app = '<script src="https://cdn.judge.me/w.js"></script>'
    const { site } = fetcher({
      [product(1)]: withReview('A') + app,
      [product(2)]: withReview('B') + app
    })
    const answer = await siteReviewSource(
      site,
      domain,
      [product(1), product(2)],
      time
    ).reviews(ask)
    expect(answer.ok && answer.platforms).toEqual([
      { name: 'Judge.me', url: product(1) }
    ])
  })

  it('finds the product pages from the home page when the catalog has none', async () => {
    const home = `https://${domain}/`
    const { site, asked } = fetcher({
      [home]: `<html><body><a href="/products/p1">Knit</a><a href="https://evil.example/products/x">No</a></body></html>`,
      [product(1)]: withReview('Maya')
    })
    const answer = await siteReviewSource(site, domain, [], time).reviews({
      brandName: 'C',
      domain
    })
    expect(asked).toEqual([home, product(1)])
    expect(answer.ok && answer.reviews[0]?.author).toBe('Maya')
  })

  it('falls back to the home page when no catalog page can be read', async () => {
    const home = `https://${domain}/`
    const { site, asked } = fetcher({
      [home]: `<html><body><a href="/products/p2">Knit</a></body></html>`,
      [product(2)]: withReview('Maya')
    })
    const answer = await siteReviewSource(
      site,
      domain,
      [product(1)],
      time
    ).reviews(ask)
    expect(asked).toEqual([product(1), home, product(2)])
    expect(answer.ok && answer.reviews[0]?.author).toBe('Maya')
  })

  it('says so when the site links to no product page', async () => {
    const home = `https://${domain}/`
    const { site } = fetcher({
      [home]: `<html><body><a href="/about">About</a></body></html>`
    })
    expect(await siteReviewSource(site, domain, [], time).reviews(ask)).toEqual(
      { ok: false, code: 'no_pages' }
    )
  })

  it('starts no page once the read is called off', async () => {
    const { site, asked } = fetcher({ [product(1)]: withReview('A') })
    const abort = new AbortController()
    abort.abort()
    expect(
      await siteReviewSource(site, domain, [product(1)], time).reviews({
        ...ask,
        signal: abort.signal
      })
    ).toEqual({ ok: false, code: 'unavailable' })
    expect(asked).toEqual([])
  })

  it('is unavailable when no page can be read, and starts no page without time for it', async () => {
    const none = fetcher({})
    expect(
      await siteReviewSource(none.site, domain, [product(1)], time).reviews({
        brandName: 'C',
        domain
      })
    ).toEqual({ ok: false, code: 'unavailable' })
    const late = fetcher({ [product(1)]: withReview('A') })
    expect(
      await siteReviewSource(late.site, domain, [product(1)], {
        now: () => 59_000,
        deadline: 60_000
      }).reviews({
        brandName: 'C',
        domain
      })
    ).toEqual({ ok: false, code: 'unavailable' })
    expect(late.asked).toEqual([])
  })

  it('reads a real brand’s own pages only with the owner’s switch', async () => {
    expect(reviewSourceFor('sample', domain, [], time, env({}))).toBe(
      sampleReviewSource
    )
    const off = reviewSourceFor('live', 'real-brand.com', [], time, env({}))
    expect(
      await off.reviews({ brandName: 'R', domain: 'real-brand.com' })
    ).toEqual({
      ok: false,
      code: 'not_set_up'
    })
    expect(
      reviewSourceFor(
        'live',
        'real-brand.com',
        [],
        time,
        env({ SITE_READER_MODE: 'live' })
      ).live
    ).toBe(true)
  })
})
