// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { createImageFetcher } from '@/features/inbox/image-fetch'
import type { ImageFetcher } from '@/lib/providers/image-fetch'
import {
  homeUrl,
  liveSiteFetcher,
  maxPageBytes,
  pageTimeoutMs,
  sampleSiteFetcher,
  siteFetchOptions,
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

describe("the live reader's guards, against a real server", () => {
  let server: Server
  let port = ''
  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? '/'
      if (path === '/')
        return res
          .writeHead(200, { 'content-type': 'text/html' })
          .end('<p>Home</p>')
      if (path === '/logo.png')
        return res.writeHead(200, { 'content-type': 'image/png' }).end('png')
      if (path === '/away')
        return res
          .writeHead(302, { location: `http://other.test:${port}/` })
          .end()
      if (path === '/down')
        return res
          .writeHead(302, { location: `http://shop.test:${port}/` })
          .end()
      res.writeHead(404).end()
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    port = String((server.address() as AddressInfo).port)
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })
  // The site reader's own options, on this machine's test server: only the
  // port and the name lookup differ (and http stands in for https here).
  const fetcher = (protocols: ('https:' | 'http:')[]) =>
    createImageFetcher({
      ...siteFetchOptions('shop.test'),
      protocols,
      ports: [port],
      isReserved: (a) => a.startsWith('10.'),
      resolve: (host, done) =>
        host === 'shop.test' || host === 'other.test'
          ? done(null, [{ address: '127.0.0.1', family: 4 }])
          : host === 'inside.shop.test'
            ? done(null, [{ address: '10.0.0.9', family: 4 }])
            : done(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }), [])
    })
  const limits = { maxBytes: maxPageBytes, timeoutMs: 2_000 }
  const at = (path: string, host = 'shop.test') =>
    `http://${host}:${port}${path}`

  it('reads an HTML page of the brand, and nothing else', async () => {
    const site = fetcher(['http:'])
    expect(await site.fetch(at('/'), limits)).toMatchObject({ ok: true })
    expect(await site.fetch(at('/logo.png'), limits)).toEqual({
      ok: false,
      failure: 'broken'
    })
    expect(await site.fetch(at('/away'), limits)).toEqual({
      ok: false,
      failure: 'blocked'
    })
    expect(await site.fetch(at('/', 'other.test'), limits)).toEqual({
      ok: false,
      failure: 'blocked'
    })
  })

  it('refuses plain http, also on a redirect, when https is required', async () => {
    expect(await fetcher(['https:']).fetch(at('/'), limits)).toEqual({
      ok: false,
      failure: 'blocked'
    })
    expect(siteFetchOptions('shop.test')).toMatchObject({
      ports: ['443'],
      protocols: ['https:']
    })
  })
})
