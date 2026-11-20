import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import {
  maxReviewText,
  type PlatformRating,
  type ReadReview
} from '@/lib/providers/review-source'
import { wellFormed } from '../words'
import {
  appsLoaded,
  maxPhotosPerReview,
  reviewPhoto,
  reviewPhotoKey,
  shopifyFolder,
  type PhotoStore
} from './photos'

/** Reviews a page is looked at for photos, and product pictures it knows. */
const maxPhotoReviews = 100
const maxPictures = 1_000

/**
 * The reviews a product page publishes as structured data (schema.org
 * `Product`/`ProductGroup` reviews, `Review` and `AggregateRating` in
 * `application/ld+json` scripts), which review apps such as Judge.me,
 * Yotpo or Okendo add for search engines. Only what the page itself
 * states: no script is run, no other host is asked. A review's photos
 * (REL-ONB2 part e) are kept as addresses only, on the store's own hosts.
 */

type Node = T.ChildNode | T.ParentNode
const isElement = (n: Node): n is T.Element => 'tagName' in n
const children = (n: Node): T.ChildNode[] =>
  'childNodes' in n ? n.childNodes : []
const attr = (n: T.Element, name: string) =>
  n.attrs.find((a) => a.name === name)?.value ?? null

/** Structured-data scripts read per page, and their size together. */
const maxScripts = 40
const maxScriptChars = 1_000_000

/** The review apps a page loads, by their script or widget address. */
const apps: [RegExp, string][] = [
  [/judge\.me|judgeme/i, 'Judge.me'],
  [/yotpo\.com|\byotpo\b/i, 'Yotpo'],
  [/okendo\.io|\bokendo\b/i, 'Okendo'],
  [/stamped\.io/i, 'Stamped'],
  [/loox\.io|\bloox-/i, 'Loox'],
  [/reviews\.io/i, 'REVIEWS.io'],
  [/trustpilot\.com/i, 'Trustpilot']
]

type Json = unknown
const isObj = (v: Json): v is Record<string, Json> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
/** A thing's types, as names without schema.org's address. */
const types = (v: Record<string, Json>) =>
  [v['@type']]
    .flat()
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.replace(/^https?:\/\/schema\.org\//i, ''))
const productTypes = new Set([
  'Product',
  'ProductGroup',
  'ProductModel',
  'IndividualProduct',
  'SomeProducts'
])
const isProduct = (v: Record<string, Json>) =>
  types(v).some((t) => productTypes.has(t))
const text = (v: Json) =>
  typeof v === 'string'
    ? v
    : typeof v === 'number'
      ? String(v)
      : isObj(v) && typeof v.name === 'string'
        ? v.name
        : ''

/** HTML's Latin-1 entities (&nbsp; to &yuml;, U+00A0 to U+00FF), by name. */
const latin1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(
    ' '
  )
const named: Record<string, string> = {
  ...Object.fromEntries(
    latin1.map((name, i) => [name, String.fromCodePoint(0xa0 + i)])
  ),
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  euro: '€',
  trade: '™'
}
/** Every entity decoded once (so `&amp;quot;` stays `&quot;`). */
const decoded = (s: string) =>
  s.replace(
    /&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi,
    (all, code: string) => {
      if (code[0] === '#') {
        const n =
          code[1] === 'x' || code[1] === 'X'
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10)
        // Half of a character pair is no character: shown as a browser does.
        if (n >= 0xd800 && n <= 0xdfff) return '\uFFFD'
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all
      }
      return named[code] ?? named[code.toLowerCase()] ?? all
    }
  )
/** The tags a review's words may carry (anything else is text, "S<M and M>L"). */
const tags =
  /<\/?(?:a|abbr|b|big|blockquote|br|center|cite|code|div|em|font|h[1-6]|hr|i|img|li|mark|ol|p|pre|q|s|small|span|strike|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul)(?:\s[^<>]*)?\/?>/gi
/**
 * The words a reader sees: entities decoded, HTML tags taken out (`<br>`
 * becomes a space; text such as "I <3 it" is kept), hidden characters out,
 * one space, no broken character pair.
 */
export const fold = (s: string) =>
  wellFormed(decoded(s))
    .replace(tags, ' ')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** A number, or a plain decimal written as text ("4.5", never "0x5"). */
const number = (v: Json) => {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(v)
        ? Number(v)
        : NaN
  return Number.isFinite(n) ? n : null
}
/** A real day, not after tomorrow (YYYY-MM-DD), else null. */
const day = (v: Json, now: number) => {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim())
  if (!m) return null
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const iso = new Date(at).toISOString().slice(0, 10)
  return iso === m[0] && at <= now + 86_400_000 ? iso : null
}

/**
 * A review's stars on a scale of five: scaled from its own best and worst
 * ("4 of 10" is 2), "4/5" read as such; `unclear` when it gives a rating
 * that cannot be read or lies outside its scale; `exact` when the page's
 * own rating is a whole number of stars out of five (3.5 and 8 of 10 are
 * rounded, so never shown as stars).
 */
function stars(r: Record<string, Json>): {
  rating: number | null
  unclear: boolean
  exact: boolean
} {
  if (r.reviewRating === undefined || r.reviewRating === null)
    return { rating: null, unclear: false, exact: true }
  const given = isObj(r.reviewRating)
    ? r.reviewRating
    : { ratingValue: r.reviewRating }
  let value = number(given.ratingValue)
  let best = given.bestRating === undefined ? 5 : number(given.bestRating)
  const worst = given.worstRating === undefined ? 1 : number(given.worstRating)
  const slash =
    typeof given.ratingValue === 'string'
      ? /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(given.ratingValue)
      : null
  if (slash) {
    value = Number(slash[1])
    best = Number(slash[2])
  }
  if (value === null || best === null || worst === null || best <= worst)
    return { rating: null, unclear: true, exact: false }
  if (value < worst || value > best)
    return { rating: null, unclear: true, exact: false }
  const five = 1 + ((value - worst) / (best - worst)) * 4
  const rating = Math.round(five)
  return { rating, unclear: false, exact: Math.abs(five - rating) < 1e-9 }
}

/** Every object in a structured-data value: lists, graphs and main entities opened. */
function* objects(v: Json, depth = 0): Generator<Record<string, Json>> {
  if (depth > 6) return
  if (Array.isArray(v)) {
    for (const x of v) yield* objects(x, depth + 1)
    return
  }
  if (!isObj(v)) return
  yield v
  for (const key of ['@graph', 'mainEntity', 'hasVariant'])
    if (v[key] !== undefined) yield* objects(v[key], depth + 1)
}

/** Scripts and styles a page loads, read for their hosts, at most. */
const maxSources = 500
/** Most characters of the page's own scripts read for its Shopify name. */
const maxInline = 1_000_000
/** Shopify's own statement of the store's name: `Shopify.shop = "name.myshopify.com"`. */
const shopifyShop =
  /^Shopify\.shop\s*=\s*(["'])([a-z0-9][a-z0-9-]*)\.myshopify\.com\1/i
const scriptTypes = /^(?:|text\/javascript|application\/javascript|module)$/i

/**
 * The Shopify names a script states, each as a statement of its own
 * (`Shopify.shop = "name.myshopify.com"` where a statement starts, after
 * `;`, `{`, `}` or a new line), read past comments and never inside a
 * string ("Shopify.shop = …" quoted in a review's words is no statement).
 * One pass, no backtracking.
 */
export function shopifyNames(code: string): string[] {
  const names: string[] = []
  let start = true
  for (let i = 0; i < code.length;) {
    const c = code[i]!
    const next = code[i + 1]
    if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2)
      i = end < 0 ? code.length : end + 2
    } else if (c === '/' && next === '/') {
      const end = code.indexOf('\n', i + 2)
      i = end < 0 ? code.length : end
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1
      i = j + 1
      start = false
    } else if (start && c === 'S' && code.startsWith('Shopify.shop', i)) {
      const m = shopifyShop.exec(code.slice(i, i + 120))
      if (m) names.push(m[2]!.toLowerCase())
      i += m ? m[0].length : 1
      start = false
    } else {
      if (c === ';' || c === '{' || c === '}' || c === '\n') start = true
      else if (!/\s/.test(c)) start = false
      i++
    }
  }
  return names
}

/**
 * The page's structured-data scripts, the hosts of the scripts and styles
 * it loads (`<script src>`, `<link href>`: how a review app is known to be
 * loaded, never any other text, so a review never vouches for its own
 * photos' host) and the store's Shopify name as the page's own scripts
 * state it (`shopifyNames`; none when they state two). Walked without
 * recursion, and only until every part is full.
 */
function scripts(
  html: string,
  page: string
): { bodies: string[]; hosts: string[]; shop: string | null } {
  const found: string[] = []
  const hosts = new Set<string>()
  let size = 0
  let inline = 0
  const shops = new Set<string>()
  const body = (n: T.Element) =>
    children(n)
      .map((c) => ('value' in c ? String(c.value) : ''))
      .join('')
  const hostOf = (link: string | null) => {
    try {
      if (link) hosts.add(new URL(link.trim(), page).hostname)
    } catch {
      // Not an address: no host.
    }
  }
  const full = () =>
    (found.length >= maxScripts || size >= maxScriptChars) &&
    hosts.size >= maxSources &&
    inline >= maxInline
  const stack: Node[] = [parse(html.slice(0, 2_000_000))]
  while (stack.length && !full()) {
    const n = stack.pop()!
    if (isElement(n) && n.tagName === 'script') {
      const type = (attr(n, 'type') ?? '').trim()
      if (type.toLowerCase() === 'application/ld+json') {
        const data = body(n)
        if (
          found.length < maxScripts &&
          size < maxScriptChars &&
          size + data.length <= maxScriptChars
        ) {
          found.push(data)
          size += data.length
        }
      } else if (attr(n, 'src') !== null) {
        if (hosts.size < maxSources) hostOf(attr(n, 'src'))
      } else if (scriptTypes.test(type) && inline < maxInline) {
        const code = body(n).slice(0, maxInline - inline)
        inline += code.length
        for (const name of shopifyNames(code)) shops.add(name)
      }
      continue
    }
    if (isElement(n) && n.tagName === 'link' && hosts.size < maxSources)
      hostOf(attr(n, 'href'))
    const kids = children(n)
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
  }
  // Two names: the page cannot say which is the store's, so none.
  return {
    bodies: found,
    hosts: [...hosts],
    shop: shops.size === 1 ? [...shops][0]! : null
  }
}

/** Picture types (never a video's or a sound's). */
const imageTypes = new Set(['ImageObject', 'MediaObject', 'Photograph'])
/** The picture addresses in a structured-data value: links or images' own. */
function links(v: Json, depth = 0): string[] {
  if (depth > 2) return []
  if (typeof v === 'string') return [v]
  if (Array.isArray(v))
    return v.slice(0, 20).flatMap((x) => links(x, depth + 1))
  if (!isObj(v)) return []
  const t = types(v)
  if (t.length && !t.some((x) => imageTypes.has(x))) return []
  const link = [v.contentUrl, v.url].find((x) => typeof x === 'string')
  return typeof link === 'string' ? [link] : []
}
/** A link as the page means it (relative to it), else null. */
const onPage = (link: string, page: string) => {
  try {
    return new URL(link.trim(), page).href
  } catch {
    return null
  }
}
/** The store's own domain from its page: its host without `www.`. */
const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export type PageReviews = {
  reviews: Omit<ReadReview, 'id'>[]
  platform: PlatformRating | null
}

/**
 * The reviews a page states in its structured data, each once: its author
 * as shown, its words, its stars (scaled to five, or unclear) and its day
 * when given. A review of something that is not a product (a shop, a
 * company) and one with no words are left out. The review app is named
 * only when the page loads exactly one.
 *
 * REL-ONB2 part e: a review's own photos (its `image` and
 * `associatedMedia`, never its author's picture), only of a review of a
 * product (never a testimonial of nothing), at most five, each once at any
 * size (`reviewPhotoKey`) and never one of the product's own pictures, only
 * where `reviewPhoto` allows them: the store's `domain`, the store's folder
 * on Shopify's CDN that its product's pictures on this page use, or the
 * confirmed host of a review app the page's own scripts load, in the
 * store's folder there. At most `maxPhotoReviews` reviews and
 * `maxPictures` product pictures are looked at.
 */
export function pageReviews(
  html: string,
  url: string,
  now = Date.now(),
  domain = siteOf(url)
): PageReviews {
  const reviews: Omit<ReadReview, 'id'>[] = []
  const seen = new Set<string>()
  const { bodies, hosts, shop } = scripts(html, url)
  const data: Json[] = []
  for (const body of bodies)
    try {
      data.push(JSON.parse(body))
    } catch {
      continue
    }
  // The product's own pictures: never a customer's, and they show the
  // store's folder on Shopify's CDN.
  const pictures: string[] = []
  for (const d of data)
    for (const o of objects(d)) {
      if (pictures.length >= maxPictures) break
      for (const p of isProduct(o) ? [o] : [o.itemReviewed].flat())
        if (isObj(p) && isProduct(p))
          for (const link of links(p.image)) {
            const href = onPage(link, url)
            if (href && pictures.length < maxPictures) pictures.push(href)
          }
    }
  const productKeys = new Set(pictures.map(reviewPhotoKey))
  const store: PhotoStore = {
    domain,
    folders: new Set(pictures.flatMap((p) => shopifyFolder(p) ?? [])),
    apps: appsLoaded(hosts),
    // The store's Shopify name: its own `myshopify.com` domain first, else
    // the one name the page's own scripts state.
    shop: /^([a-z0-9-]+)\.myshopify\.com$/.exec(domain)?.[1] ?? shop
  }
  let looked = 0
  const photosOf = (r: Record<string, Json>, author: string) => {
    if (r.image === undefined && r.associatedMedia === undefined) return []
    if (++looked > maxPhotoReviews) return []
    const kept: string[] = []
    const keys = new Set<string>()
    for (const link of links([r.image, r.associatedMedia].flat())) {
      if (kept.length >= maxPhotosPerReview) break
      const photo = reviewPhoto(link, url, store, author)
      const key = photo && reviewPhotoKey(photo)
      if (!photo || !key || productKeys.has(key) || keys.has(key)) continue
      keys.add(key)
      kept.push(photo)
    }
    return kept
  }
  const add = (
    r: Record<string, Json>,
    product: string | null,
    ofProduct = true
  ) => {
    const words = fold(text(r.reviewBody) || text(r.description))
    if (!words) return
    const author = wellFormed(fold(text(r.author)).slice(0, 80))
    const key = `${author.toLowerCase()}\n${words.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    const { rating, unclear, exact } = stars(r)
    const photos = ofProduct ? photosOf(r, author) : []
    reviews.push({
      author,
      text: wellFormed(words.slice(0, maxReviewText)),
      rating,
      ratingUnclear: unclear,
      ratingExact: exact,
      date: day(r.datePublished, now),
      url,
      product,
      ...(photos.length ? { photos } : {})
    })
  }
  for (const d of data) {
    for (const o of objects(d)) {
      if (isProduct(o)) {
        const name = wellFormed(fold(text(o.name)).slice(0, 120)) || null
        for (const r of [o.review].flat()) if (isObj(r)) add(r, name)
      } else if (types(o).includes('Review')) {
        const items = [o.itemReviewed].flat().filter(isObj)
        // Only a review of a product (or of nothing typed, on a product
        // page): never one that says it is of a shop or a company.
        if (items.some((i) => types(i).length && !isProduct(i))) continue
        const item = items[0] ?? o.itemReviewed
        // Its photos only when it says it is of a product (a theme's
        // testimonial of nothing may show the brand's own pictures).
        add(
          o,
          wellFormed(fold(text(item)).slice(0, 120)) || null,
          items.some(isProduct)
        )
      }
    }
  }
  const loaded = apps.filter(([pattern]) => pattern.test(html))
  return {
    reviews,
    platform: loaded.length === 1 ? { name: loaded[0]![1], url } : null
  }
}
