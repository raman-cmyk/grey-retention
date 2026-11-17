// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import type { ImageFetcher } from '@/lib/providers/image-fetch'
import {
  liveSiteFetcher,
  sampleSiteFetcher,
  sheetFetchOptions,
  sheetHosts,
  sheetTimeoutMs
} from './fetch'
import { maxCss } from './fonts'

const answering = (result: Awaited<ReturnType<ImageFetcher['fetch']>>) => {
  const fetch = vi.fn(async () => result)
  return { fetch, fetcher: { fetch } as ImageFetcher }
}
const css = (text: string) => new TextEncoder().encode(text)
const site = (own: ImageFetcher, google: ImageFetcher) => {
  const unused = answering({ ok: false, failure: 'broken' }).fetcher
  return liveSiteFetcher('cedarlane.com', unused, unused, { own, google })
}

describe('the stylesheets (FONT-b)', () => {
  it('reads the brand’s own and the font services’ stylesheets over https, within their limits', async () => {
    const own = answering({
      ok: true,
      bytes: css('h1{font-family:Cedar}'),
      url: 'https://cedarlane.com/cdn/theme.css?v=2'
    })
    const google = answering({ ok: true, bytes: css('@font-face{}') })
    const reader = site(own.fetcher, google.fetcher)
    expect(
      await reader.stylesheet!('https://cedarlane.com/cdn/theme.css')
    ).toEqual({
      // The address it was read from, after redirects.
      url: 'https://cedarlane.com/cdn/theme.css?v=2',
      css: 'h1{font-family:Cedar}'
    })
    expect(own.fetch).toHaveBeenCalledWith(
      'https://cedarlane.com/cdn/theme.css',
      { maxBytes: maxCss, timeoutMs: sheetTimeoutMs }
    )
    for (const url of [
      'https://shop.cedarlane.com/a.css',
      'https://cdn.shopify.com/s/files/1/theme.css',
      'https://use.typekit.net/abc1234.css',
      'https://fonts.bunny.net/css?family=inter'
    ])
      expect(await reader.stylesheet!(url), url).not.toBeNull()
    // Google Fonts through its own reader, which asks as a browser.
    const fonts = 'https://fonts.googleapis.com/css2?family=Inter'
    expect(await reader.stylesheet!(fonts)).toEqual({
      url: fonts,
      css: '@font-face{}'
    })
    expect(google.fetch).toHaveBeenCalledTimes(1)
    expect(own.fetch).toHaveBeenCalledTimes(5)
  })

  it('never reads another site’s stylesheet, plain http, or one it cannot read', async () => {
    const own = answering({ ok: true, bytes: css('x') })
    const reader = site(own.fetcher, own.fetcher)
    for (const url of [
      'https://evil.com/theme.css',
      'https://cedarlane.com.evil.com/theme.css',
      'https://evilcedarlane.com/theme.css',
      'https://fonts.gstatic.com/s/inter.woff2',
      'http://cedarlane.com/theme.css',
      'ftp://cedarlane.com/theme.css',
      'not a link'
    ])
      expect(await reader.stylesheet!(url), url).toBeNull()
    expect(own.fetch).not.toHaveBeenCalled()
    for (const broken of [
      answering({ ok: false, failure: 'timeout' }).fetcher,
      answering({ ok: true, bytes: new Uint8Array([0, 1, 2]) }).fetcher,
      {
        fetch: async () => {
          throw new Error('socket hang up')
        }
      } as ImageFetcher
    ])
      expect(
        await site(broken, broken).stylesheet!('https://cedarlane.com/a.css')
      ).toBeNull()
  })

  it('asks for CSS only, over https on 443, from the stylesheet hosts (also on a redirect)', () => {
    const own = sheetFetchOptions('cedarlane.com')
    const google = sheetFetchOptions('cedarlane.com', true)
    for (const options of [own, google]) {
      expect(options).toMatchObject({ ports: ['443'], protocols: ['https:'] })
      expect(options.types.test('text/css; charset=utf-8')).toBe(true)
      for (const type of ['text/html', 'text/plain', 'font/woff2', ''])
        expect(options.types.test(type), type).toBe(false)
    }
    expect(google.userAgent).toMatch(/Chrome\/\d+/)
    expect(own.userAgent).toContain('BrandReader')
    expect(google.allowHost('fonts.googleapis.com')).toBe(true)
    expect(google.allowHost('cedarlane.com')).toBe(false)
    const hosts = sheetHosts('www.cedarlane.com')
    expect(own.allowHost('www.cedarlane.com')).toBe(true)
    expect(hosts('fast.fonts.net')).toBe(true)
    expect(hosts('cedarlane.com.evil.com')).toBe(false)
  })

  it('has none for the sample site', () => {
    expect(sampleSiteFetcher('cedar-lane.example').stylesheet).toBeUndefined()
  })
})
