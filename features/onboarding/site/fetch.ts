import 'server-only'
import { createImageFetcher } from '@/features/inbox/image-fetch'
import type { ImageFetcher } from '@/lib/providers/image-fetch'
import { siteHosts } from './fetch-hosts'
import { fontCdns, maxCss, type Sheet } from './fonts'
import { maxLogoBytes } from './logos'
import { samplePage } from './sample'

export { homeUrl, siteHosts } from './fetch-hosts'

/**
 * Reads one page of the brand's own website (ONB-101). The live reader
 * only ever opens the brand's own host (the domain or its `www.`), over
 * https, never a private address (checked again on every redirect, at
 * most 3, and a redirect to another host is refused), HTML only, within a
 * size and time limit. The sample reader serves a sample site for the
 * synthetic brands and opens nothing.
 */
export type SitePageResult =
  | { ok: true; url: string; html: string }
  | {
      ok: false
      failure: 'blocked' | 'broken' | 'timeout' | 'too_large' | 'not_found'
    }

export interface SiteFetcher {
  readonly live: boolean
  fetch(url: string): Promise<SitePageResult>
  /**
   * One logo picture's bytes, or null when it cannot be read (ONB-060b).
   * Only the live reader has it: the sample site keeps no logo.
   */
  picture?(url: string): Promise<Uint8Array | null>
  /**
   * One stylesheet a page links, as read (FONT-SITE part b), or null when
   * it cannot be read. Only the live reader has it: the sample site keeps
   * no font.
   */
  stylesheet?(url: string): Promise<Sheet | null>
}

/** Largest page read. */
export const maxPageBytes = 1_500_000
/** Longest one page may take. */
export const pageTimeoutMs = 6_000
/** Longest one logo picture may take. */
export const logoTimeoutMs = 3_000

/**
 * The guards for a logo picture: https on 443 (also on every redirect),
 * any public host (a store's pictures are often on its platform's), only
 * the picture types an email may show (PNG, JPEG, GIF: what Klaviyo
 * imports), never a private address (the image fetcher's own).
 */
export const logoFetchOptions = {
  ports: ['443'],
  protocols: ['https:' as const],
  accept: 'image/png,image/jpeg;q=0.9,image/gif;q=0.8',
  types: /^\s*image\/(png|jpeg|gif)\b/i,
  userAgent: 'Mozilla/5.0 (compatible; BrandReader/1.0)'
}

/** Longest one stylesheet may take. */
export const sheetTimeoutMs = 3_000

/**
 * The hosts a brand's stylesheets are read from (FONT-SITE part b): its
 * own host and subdomains, its store platform's (`cdn.shopify.com`) and
 * the font services part a lists; never another site's.
 */
export function sheetHosts(domain: string) {
  const own = siteHosts(domain)
  return (host: string) =>
    own.has(host) || fontServices.has(host) || fontCdns.has(host)
}
const fontServices = new Set([
  'cdn.shopify.com',
  'fonts.googleapis.com',
  'use.typekit.net'
])
const google = (host: string) => host === 'fonts.googleapis.com'

/**
 * The guards for a stylesheet: https on 443 (also on every redirect), the
 * stylesheet hosts only, CSS only. Google Fonts writes its CSS for the
 * browser that asks, so it is asked as a browser that reads WOFF2.
 */
export function sheetFetchOptions(domain: string, forGoogle = false) {
  return {
    ports: ['443'],
    protocols: ['https:' as const],
    accept: 'text/css,*/*;q=0.1',
    types: /^\s*text\/css\b/i,
    userAgent: forGoogle
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      : 'Mozilla/5.0 (compatible; BrandReader/1.0)',
    allowHost: forGoogle ? google : sheetHosts(domain)
  }
}

/**
 * The guards of the live reader for one brand: https only (also on every
 * redirect), port 443, the brand's own host and its `www.`, HTML only.
 */
export function siteFetchOptions(domain: string) {
  const hosts = siteHosts(domain)
  return {
    ports: ['443'],
    protocols: ['https:' as const],
    accept: 'text/html,application/xhtml+xml;q=0.9',
    types: /^\s*(text\/html|application\/xhtml\+xml)\b/i,
    userAgent: 'Mozilla/5.0 (compatible; BrandReader/1.0)',
    allowHost: (host: string) => hosts.has(host)
  }
}

/**
 * The live reader for one brand: pages over https on 443 from its own
 * host only; logo pictures over https on 443 from any public host;
 * stylesheets over https on 443 from the stylesheet hosts only.
 */
export function liveSiteFetcher(
  domain: string,
  fetcher?: ImageFetcher,
  pictures?: ImageFetcher,
  sheets?: { own: ImageFetcher; google: ImageFetcher }
): SiteFetcher {
  const hosts = siteHosts(domain)
  const http = fetcher ?? createImageFetcher(siteFetchOptions(domain))
  const images = pictures ?? createImageFetcher(logoFetchOptions)
  const css = sheets ?? {
    own: createImageFetcher(sheetFetchOptions(domain)),
    google: createImageFetcher(sheetFetchOptions(domain, true))
  }
  const sheetHost = sheetHosts(domain)
  return {
    live: true,
    async stylesheet(url) {
      let host: string
      try {
        const u = new URL(url)
        host = u.protocol === 'https:' ? u.hostname : ''
      } catch {
        return null
      }
      if (!sheetHost(host)) return null
      const got = await (google(host) ? css.google : css.own)
        .fetch(url, { maxBytes: maxCss, timeoutMs: sheetTimeoutMs })
        .catch(() => null)
      if (!got?.ok) return null
      const text = new TextDecoder('utf-8', { fatal: false }).decode(got.bytes)
      // A binary body sent as CSS is not a stylesheet.
      return text.includes('\u0000') ? null : { url: got.url ?? url, css: text }
    },
    async picture(url) {
      if (!url.startsWith('https://')) return null
      const got = await images
        .fetch(url, { maxBytes: maxLogoBytes, timeoutMs: logoTimeoutMs })
        .catch(() => null)
      return got?.ok ? got.bytes : null
    },
    async fetch(url) {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return { ok: false, failure: 'broken' }
      }
      if (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname))
        return { ok: false, failure: 'blocked' }
      const page = await http.fetch(url, {
        maxBytes: maxPageBytes,
        timeoutMs: pageTimeoutMs
      })
      if (!page.ok)
        return {
          ok: false,
          failure:
            page.failure === 'blocked' ||
            page.failure === 'timeout' ||
            page.failure === 'too_large'
              ? page.failure
              : 'broken'
        }
      const html = new TextDecoder('utf-8', { fatal: false }).decode(page.bytes)
      // A binary body sent as HTML is not a page.
      if (html.includes('\u0000')) return { ok: false, failure: 'broken' }
      return { ok: true, url: page.url ?? url, html }
    }
  }
}

/** The sample reader: a sample site for synthetic (`.example`) brands. */
export function sampleSiteFetcher(domain: string): SiteFetcher {
  const hosts = siteHosts(domain)
  return {
    live: false,
    async fetch(url) {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return { ok: false, failure: 'broken' }
      }
      if (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname))
        return { ok: false, failure: 'blocked' }
      const html = samplePage(domain, parsed.pathname)
      return html === null
        ? { ok: false, failure: 'not_found' }
        : { ok: true, url, html }
    }
  }
}

/**
 * The reader to use: the sample one unless `SITE_READER_MODE=live` is set
 * (the owner's choice, like `KLAVIYO_MODE`), and always the sample one for
 * a synthetic `.example` brand.
 */
export function siteFetcherFor(
  domain: string,
  env: NodeJS.ProcessEnv = process.env
): SiteFetcher {
  if (env.SITE_READER_MODE === 'live' && !/\.example$/i.test(domain.trim()))
    return liveSiteFetcher(domain)
  return sampleSiteFetcher(domain)
}
