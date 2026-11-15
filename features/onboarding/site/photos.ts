import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import { importable } from '@/features/klaviyo-push/html'
import type { SitePageKind } from '../findings'
import {
  absolute,
  landmarks,
  largestOfSet,
  logoCandidates,
  namedLogo,
  otherBrands,
  words
} from './logos'

/**
 * The photo library's site part (owner pick #59, ONB-059a): the product
 * and lifestyle photos on one of the brand's own pages, each tagged for
 * reuse. Pure: the Site reader fetches the pages (ONB-059b keeps the
 * photos, with the catalog's own pictures). Only photos an email could
 * show (https on the standard port, a format Klaviyo imports, never SVG
 * or WebP); never the brand's logo, an icon, a badge or another brand's
 * logo; never a picture of the page's header, menu or footer.
 */

export type PhotoKind = 'product' | 'lifestyle'

export type SitePhoto = {
  /** Absolute https. */
  url: string
  /** Its own description on the page, when it has one. */
  alt: string | null
  /** A product photo, or one of the brand's world (people, places, use). */
  kind: PhotoKind
  /** The page it was found on. */
  page: SitePageKind
  /** Where: the product's structured data, the page's share picture, or the page itself. */
  from: 'schema' | 'share' | 'page'
}

/** Most photos kept per page. */
export const maxPhotosPerPage = 30
/** A picture whose stated width or height is smaller is an icon. */
export const minPhotoSide = 200
/** Longest address kept. */
const maxPhotoUrl = 1_000

type Node = T.ChildNode | T.ParentNode
const isElement = (n: Node): n is T.Element => 'tagName' in n
const attr = (n: T.Element, name: string) =>
  n.attrs.find((a) => a.name === name)?.value ?? null
const children = (n: Node): T.ChildNode[] =>
  'childNodes' in n ? n.childNodes : []
const textOf = (n: Node): string =>
  n.nodeName === '#text'
    ? (n as T.TextNode).value
    : children(n).map(textOf).join('')

/** Words that name a picture which is no photo. */
const notPhotos = new Set([
  'icon',
  'icons',
  'badge',
  'badges',
  'flag',
  'flags',
  'sprite',
  'placeholder',
  'spinner',
  'loader',
  'loading',
  'pixel',
  'avatar',
  'rating',
  'stars',
  'payment',
  'arrow',
  'chevron'
])

/** An address an email can show and the library keeps. */
const keepable = (url: string) =>
  url.length <= maxPhotoUrl &&
  /^https:\/\/[^/:?#@]+(?:[/?#]|$)/.test(url) &&
  importable(url) &&
  !/\.gif(?:$|[?#])/i.test(new URL(url).pathname)

/** The same photo at another size is one photo (`?width=800`, `_400x`). */
function photoKey(url: string) {
  const u = new URL(url)
  for (const p of ['width', 'height', 'w', 'h', 'crop', 'v', 'quality'])
    u.searchParams.delete(p)
  u.pathname = u.pathname.replace(
    /_(?:\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)(?=\.[a-z]+$)/i,
    ''
  )
  return u.toString().toLowerCase()
}

/** Product pictures in structured data (`Product`, anywhere in it). */
function schemaImages(json: unknown, out: string[], depth = 0) {
  if (depth > 8 || out.length > 50) return
  if (Array.isArray(json)) {
    for (const item of json) schemaImages(item, out, depth + 1)
    return
  }
  if (!json || typeof json !== 'object') return
  const o = json as Record<string, unknown>
  const type = ([] as unknown[]).concat(o['@type'] ?? [])
  if (type.some((t) => typeof t === 'string' && /^product$/i.test(t))) {
    for (const image of ([] as unknown[]).concat(o.image ?? [])) {
      if (typeof image === 'string') out.push(image)
      else if (image && typeof image === 'object') {
        const i = image as Record<string, unknown>
        const url = i.contentUrl ?? i.url
        if (typeof url === 'string') out.push(url)
      }
    }
  }
  for (const [key, value] of Object.entries(o))
    if (key !== 'image' && value && typeof value === 'object')
      schemaImages(value, out, depth + 1)
}

/** Whether a link opens a product page (`/products/…`, `/product/…`, `/p/…`). */
const productLink = (href: string | null) =>
  !!href && /\/(?:products?|p)\/[^/?#]+/i.test(href)

/**
 * The photos on one page, surest first: the product's structured data,
 * then its share picture, then the pictures in the page itself. On a
 * product page every photo is a product photo; elsewhere a picture that
 * links to a product page is, and the rest are lifestyle photos.
 */
export function sitePhotos(
  html: string,
  page: string,
  kind: SitePageKind,
  { brand = '' }: { brand?: string } = {}
): SitePhoto[] {
  try {
    new URL(page)
  } catch {
    return []
  }
  const doc = parse(html.slice(0, 2_000_000))
  const logos = new Set(
    logoCandidates(html, page, { brand }).map((c) => photoKey(c.url))
  )
  const found: SitePhoto[] = []
  const add = (
    src: string | null,
    from: SitePhoto['from'],
    photoKind: PhotoKind,
    alt: string | null = null
  ) => {
    const url = absolute(src, page)
    if (!url || !keepable(url)) return
    const text = alt?.replace(/\s+/g, ' ').trim().slice(0, 200) || null
    found.push({ url, alt: text, kind: photoKind, page: kind, from })
  }
  const pageKind: PhotoKind = kind === 'product' ? 'product' : 'lifestyle'
  const sourceOf = (c: T.Element) =>
    [
      attr(c, 'src'),
      attr(c, 'data-src'),
      attr(c, 'data-lazy-src'),
      attr(c, 'data-original'),
      largestOfSet(attr(c, 'srcset')),
      largestOfSet(attr(c, 'data-srcset'))
    ].find((s) => absolute(s, page)) ?? null
  const small = (c: T.Element) =>
    ['width', 'height'].some((a) => {
      const n = Number(attr(c, a))
      return Number.isFinite(n) && n > 0 && n < minPhotoSide
    })
  type Place = { chrome: boolean; others: boolean; product: boolean }
  const walk = (n: Node, at: Place) => {
    for (const c of children(n)) {
      if (!isElement(c)) continue
      const tag = c.tagName
      if (
        tag === 'script' &&
        (attr(c, 'type') ?? '').toLowerCase() === 'application/ld+json'
      ) {
        const urls: string[] = []
        try {
          schemaImages(JSON.parse(textOf(c).slice(0, 200_000)), urls)
        } catch {
          // Not readable structured data: the page's pictures still count.
        }
        for (const u of urls) add(u, 'schema', 'product')
        continue
      }
      if (tag === 'meta') {
        const name = (
          attr(c, 'property') ??
          attr(c, 'name') ??
          ''
        ).toLowerCase()
        if (name === 'og:image' || name === 'twitter:image')
          add(attr(c, 'content'), 'share', pageKind)
        continue
      }
      const label = [attr(c, 'class'), attr(c, 'id'), attr(c, 'aria-label')]
      if (tag === 'img' || (tag === 'source' && !at.chrome)) {
        if (at.chrome || at.others || small(c)) continue
        const src = sourceOf(c)
        const alt = attr(c, 'alt')
        const own = words(src && new URL(src, page).pathname, alt, ...label)
        if (namedLogo(...own) || own.some((w) => notPhotos.has(w))) continue
        add(src, 'page', at.product ? 'product' : pageKind, alt)
        continue
      }
      walk(c, {
        chrome:
          at.chrome || tag === 'header' || tag === 'nav' || tag === 'footer',
        others:
          at.others ||
          (!landmarks.has(tag) &&
            words(...label).some((w) => otherBrands.has(w))),
        product: at.product || (tag === 'a' && productLink(attr(c, 'href')))
      })
    }
  }
  walk(doc, { chrome: false, others: false, product: false })
  const rank = { schema: 0, share: 1, page: 2 } as const
  const seen = new Set<string>()
  return found
    .sort((a, b) => rank[a.from] - rank[b.from])
    .filter((p) => {
      const key = photoKey(p.url)
      if (logos.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, maxPhotosPerPage)
}
