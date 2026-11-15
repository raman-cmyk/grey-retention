import 'server-only'
import { createImageFetcher } from '@/features/inbox/image-fetch'
import type { ImageFetcher } from '@/lib/providers/image-fetch'
import { siteHosts } from './fetch-hosts'
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
}

/** Largest page read. */
export const maxPageBytes = 1_500_000
/** Longest one page may take. */
export const pageTimeoutMs = 6_000
/** Longest one logo picture may take. */
export const logoTimeoutMs = 3_000

/**
 * The guards for a logo picture: https on 443 (also on every redirect),
 * any public host (a store's pictures are often on its platform's), a
 * picture type only, never a private address (the image fetcher's own).
 */
export const logoFetchOptions = {
  ports: ['443'],
  protocols: ['https:' as const],
  accept: 'image/svg+xml,image/png,image/*;q=0.8',
  types: /^\s*image\/(png|svg\+xml|jpeg|webp|gif)\b/i,
  userAgent: 'Mozilla/5.0 (compatible; BrandReader/1.0)'
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
 * host only; logo pictures over https on 443 from any public host.
 */
export function liveSiteFetcher(
  domain: string,
  fetcher?: ImageFetcher,
  pictures?: ImageFetcher
): SiteFetcher {
  const hosts = siteHosts(domain)
  const http = fetcher ?? createImageFetcher(siteFetchOptions(domain))
  const images = pictures ?? createImageFetcher(logoFetchOptions)
  return {
    live: true,
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
