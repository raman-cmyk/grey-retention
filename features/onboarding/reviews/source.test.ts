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
  delays: Record<string, number> = {}
) {
  const asked: string[] = []
  const site: SiteFetcher = {
    live: true,
    async fetch(url): Promise<SitePageResult> {
      asked.push(url)
      if (delays[url]) await new Promise((r) => setTimeout(r, delays[url]))
      const html = pages[url]
      return html
        ? { ok: true, url, html }
        : { ok: false, failure: 'not_found' }
    }
  }
  return { site, asked }
}
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
