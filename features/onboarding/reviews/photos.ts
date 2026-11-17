import { onDomain } from '@/lib/providers/ad-library'
import { photoUrlPattern } from '../findings'
import { emailPhotoUrl, photoKey } from '../site/photos'

/**
 * REL-ONB2 part e: the photos customers posted with their reviews on the
 * store's own product pages, as the pages' review data gives them. Only
 * an address is kept (never fetched here): https, a JPEG or PNG an email
 * can show, on a host that is the store's own.
 */

/** Photos one read keeps, and one review's at most. */
export const maxReviewPhotos = 12
export const maxPhotosPerReview = 5
/** The longest photo address kept (the database's limit). */
export const maxReviewPhotoUrl = 500

/**
 * The image host of each review app (named as `pageReviews` names the
 * apps), only where it was confirmed, and the hosts its own scripts load
 * from (how a page is known to load it):
 *
 * - Judge.me: its help centre says review photos are uploaded to and
 *   served by imgix, and a real reviews API response shows each picture
 *   on `judgeme.imgix.net`, in a folder named after the store's Shopify
 *   name (`<name>.myshopify.com`); its scripts load from `judge.me`. The
 *   folder's naming rule rests on that one example: a photo is kept only
 *   in the folder of the store's own Shopify name, so if the rule is
 *   otherwise, none is (the safe side).
 *
 * Left out until their host is confirmed (no photo of theirs is kept):
 * Yotpo, Okendo, Stamped, Loox, REVIEWS.io and Trustpilot.
 */
export const reviewAppPhotoHosts: Readonly<Record<string, readonly string[]>> =
  { 'Judge.me': ['judgeme.imgix.net'] }
export const reviewAppScriptHosts: Readonly<Record<string, readonly string[]>> =
  { 'Judge.me': ['judge.me'] }

/** The review apps whose own scripts or styles a page loads, by their hosts. */
export function appsLoaded(hosts: readonly string[]): string[] {
  return Object.entries(reviewAppScriptHosts)
    .filter(([, own]) => hosts.some((h) => own.some((o) => onDomain(h, o))))
    .map(([app]) => app)
}

const shopifyCdn = 'cdn.shopify.com'
/** A store's own folder on Shopify's CDN: `/s/files/1/0123/4567/8901/`. */
const shopFolder = /^\/s\/files\/1\/\d{4}\/\d{4}\/(?:\d{4}\/)?(?=[a-z])/i

/** The store's folder on Shopify's CDN a picture is in, else null. */
export function shopifyFolder(url: string): string | null {
  try {
    const u = new URL(url)
    return u.hostname === shopifyCdn
      ? (shopFolder.exec(u.pathname)?.[0].toLowerCase() ?? null)
      : null
  } catch {
    return null
  }
}

/** The folder of a review app's photo (`judgeme.imgix.net/<name>/…`), else null. */
export function appFolder(url: string): string | null {
  try {
    const u = new URL(url)
    const apps = Object.values(reviewAppPhotoHosts).flat()
    return apps.includes(u.hostname)
      ? (/^\/([^/]+)\/[^/]/.exec(u.pathname)?.[1] ?? null)
      : null
  } catch {
    return null
  }
}

/**
 * One picture at any size or format, as the database compares them
 * (`private.review_photo_key`): its host and path without any query
 * (imgix's `w`, `dpr`, `fit`, Shopify's `width`, `v`…) or size in its name
 * (`_800x`), and a Shopify file by its path after `/cdn/shop/` or after the
 * store's folder on Shopify's CDN, whichever host serves it.
 */
export function reviewPhotoKey(url: string): string {
  const u = new URL(url)
  const path = photoKey(`${u.origin}${u.pathname}`).slice(u.hostname.length)
  const file =
    /^\/cdn\/shop\/(.+)$/.exec(path)?.[1] ??
    (u.hostname === shopifyCdn
      ? new RegExp(`${shopFolder.source}(.+)$`, 'i').exec(path)?.[1]
      : undefined)
  return file ? `shopify:${file}` : `${u.hostname}${path}`
}

/** The words of a reviewer's name (two letters or more), in lower case. */
const nameWords = (author: string) =>
  (author.toLowerCase().match(/\p{L}{2,}/gu) ?? []).filter(
    (w) => !['dr', 'mr', 'mrs', 'ms'].includes(w)
  )
/** The words of an address's path and query, decoded, in lower case. */
const addressWords = (url: URL) => {
  let text = `${url.pathname} ${url.search}`
  try {
    text = decodeURIComponent(text.replace(/\+/g, ' '))
  } catch {
    // Kept as written: its words still count.
  }
  return new Set(text.toLowerCase().match(/\p{L}+/gu) ?? [])
}

export type PhotoStore = {
  /** The store's domain, lower case, without `www.`. */
  domain: string
  /** Its folders on Shopify's CDN, as its product's own pictures show them. */
  folders: ReadonlySet<string>
  /** The review apps the page's own scripts or styles load. */
  apps: readonly string[]
  /** The store's Shopify name (`<name>.myshopify.com`), when the page says it. */
  shop: string | null
}

/**
 * A review photo's address as the page links it, kept only when an email
 * can show it (`emailPhotoUrl`, at most 500 characters), in the shape the
 * database keeps (`photoUrlPattern`: a plain host, URL-safe characters, no
 * `@`), with no word of the reviewer's name in its path or query, and its
 * host is the store's own domain (or a subdomain), the store's own folder
 * on Shopify's CDN (one its product's own pictures on the page use), or
 * the confirmed image host of a review app the page loads, in the store's
 * own folder there (Judge.me's: the store's Shopify name). Imgix's `auto`
 * is taken out (it may serve WebP or AVIF). Null for any other.
 */
export function reviewPhoto(
  link: string,
  page: string,
  store: PhotoStore,
  author = ''
): string | null {
  let url: URL
  try {
    url = new URL(link.trim(), page)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.hostname.endsWith('.imgix.net')) url.searchParams.delete('auto')
  const href = url.href
  if (
    href.length > maxReviewPhotoUrl ||
    !photoUrlPattern.test(href) ||
    !emailPhotoUrl(href)
  )
    return null
  const words = addressWords(url)
  if (nameWords(author).some((w) => words.has(w))) return null
  const host = url.hostname
  const app = store.apps.some((a) => reviewAppPhotoHosts[a]?.includes(host))
  const own =
    onDomain(host, store.domain) ||
    (host === shopifyCdn && store.folders.has(shopifyFolder(href) ?? '')) ||
    (app && !!store.shop && appFolder(href)?.toLowerCase() === store.shop)
  return own ? href : null
}

/**
 * Whether a kept photo's host may be the store's at all, as the database
 * checks it (`private.review_photo_host_ok`): its own domain (or a
 * subdomain), a store's folder on Shopify's CDN, or a confirmed review app
 * host. A stored photo is read again with it.
 */
export function reviewPhotoHost(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname
    return (
      onDomain(host, domain) ||
      shopifyFolder(url) !== null ||
      Object.values(reviewAppPhotoHosts).some((h) => h.includes(host))
    )
  } catch {
    return false
  }
}
