import { onDomain } from '@/lib/providers/ad-library'
import { emailPhotoUrl } from '../site/photos'

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
 * apps a page loads), only where it was confirmed:
 *
 * - Judge.me: its help centre says review photos are uploaded to and
 *   served by imgix, and a real reviews API response shows each picture
 *   on `judgeme.imgix.net`.
 *
 * Left out until their host is confirmed (no photo of theirs is kept):
 * Yotpo, Okendo, Stamped, Loox, REVIEWS.io and Trustpilot.
 */
export const reviewAppPhotoHosts: Readonly<Record<string, readonly string[]>> =
  { 'Judge.me': ['judgeme.imgix.net'] }

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

/**
 * A review photo's address as the page links it, kept only when an email
 * can show it (`emailPhotoUrl`, at most 500 characters) and its host is
 * the store's own domain (or a subdomain), the store's own folder on
 * Shopify's CDN (one its product's own pictures on the page use), or the
 * confirmed image host of a review app the page loads. Null for any other.
 */
export function reviewPhoto(
  link: string,
  page: string,
  store: { domain: string; folders: ReadonlySet<string>; apps: string[] }
): string | null {
  let url: URL
  try {
    url = new URL(link.trim(), page)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const href = url.href
  if (href.length > maxReviewPhotoUrl || !emailPhotoUrl(href)) return null
  const host = url.hostname
  const own =
    onDomain(host, store.domain) ||
    (host === shopifyCdn && store.folders.has(shopifyFolder(href) ?? '')) ||
    store.apps.some((a) => reviewAppPhotoHosts[a]?.includes(host))
  return own ? href : null
}
