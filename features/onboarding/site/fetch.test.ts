// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import type { ImageFetcher } from '@/lib/providers/image-fetch'
import {
  homeUrl,
  liveSiteFetcher,
  maxPageBytes,
  pageTimeoutMs,
  sampleSiteFetcher,
  siteFetcherFor,
  siteHosts
} from './fetch'

const answering = (result: Awaited<ReturnType<ImageFetcher['fetch']>>) => {
  const fetch = vi.fn(async () => result)
  return { fetch, fetcher: { fetch } as ImageFetcher }
}

describe('the site hosts', () => {
  it("are the brand's domain and its www., and the home page is https", () => {
    expect([...siteHosts('WWW.Cedar-Lane.example ')]).toEqual([
      'cedar-lane.example',
      'www.cedar-lane.example'
    ])
    expect(homeUrl('cedar-lane.example')).toBe('https://cedar-lane.example/')
    for (const bad of [
      '',
      'localhost',
      'https://x.com',
      'x.com/path',
      'a b.com'
    ])
      expect(homeUrl(bad), bad).toBeNull()
  })
})

describe('the live site reader', () => {
  it("opens only https pages on the brand's own host, within the page limits", async () => {
    const { fetch, fetcher } = answering({
      ok: true,
      bytes: new TextEncoder().encode('<p>Hi</p>'),
      url: 'https://www.shop.com/'
    })
    const site = liveSiteFetcher('shop.com', fetcher)
    expect(site.live).toBe(true)
    expect(await site.fetch('https://www.shop.com/')).toEqual({
      ok: true,
      url: 'https://www.shop.com/',
      html: '<p>Hi</p>'
    })
    expect(fetch).toHaveBeenCalledWith('https://www.shop.com/', {
      maxBytes: maxPageBytes,
      timeoutMs: pageTimeoutMs
    })
    for (const url of [
      'http://shop.com/',
      'https://other.com/',
      'https://shop.com.evil.com/',
      'not a url'
    ])
      expect(await site.fetch(url), url).toMatchObject({ ok: false })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports a page it cannot read, and refuses a binary body', async () => {
    for (const [failure, expected] of [
      ['blocked', 'blocked'],
      ['timeout', 'timeout'],
      ['too_large', 'too_large'],
      ['not_image', 'broken'],
      ['broken', 'broken']
    ] as const)
      expect(
        await liveSiteFetcher(
          'shop.com',
          answering({ ok: false, failure }).fetcher
        ).fetch('https://shop.com/')
      ).toEqual({ ok: false, failure: expected })
    expect(
      await liveSiteFetcher(
        'shop.com',
        answering({ ok: true, bytes: new Uint8Array([60, 0, 62]) }).fetcher
      ).fetch('https://shop.com/')
    ).toEqual({ ok: false, failure: 'broken' })
  })
})

describe('the sample site reader', () => {
  it('serves the sample site for a synthetic brand and opens nothing', async () => {
    const site = sampleSiteFetcher('cedar-lane.example')
    expect(site.live).toBe(false)
    expect(
      await site.fetch('https://cedar-lane.example/pages/returns')
    ).toMatchObject({
      ok: true
    })
    expect(await site.fetch('https://cedar-lane.example/nowhere')).toEqual({
      ok: false,
      failure: 'not_found'
    })
    expect(await site.fetch('https://other.example/')).toEqual({
      ok: false,
      failure: 'blocked'
    })
  })

  it('never invents a page for a real brand', async () => {
    expect(
      await sampleSiteFetcher('shop.com').fetch('https://shop.com/')
    ).toEqual({
      ok: false,
      failure: 'not_found'
    })
  })

  it('is used unless the live reader is switched on, and always for a synthetic brand', () => {
    const env = (values: Record<string, string>) =>
      values as unknown as NodeJS.ProcessEnv
    expect(siteFetcherFor('shop.com', env({})).live).toBe(false)
    expect(
      siteFetcherFor('shop.com', env({ SITE_READER_MODE: 'live' })).live
    ).toBe(true)
    expect(
      siteFetcherFor('cedar-lane.example', env({ SITE_READER_MODE: 'live' }))
        .live
    ).toBe(false)
  })
})
