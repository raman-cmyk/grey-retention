import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import {
  maxReviewText,
  type PlatformRating,
  type ReadReview
} from '@/lib/providers/review-source'
import { wellFormed } from '../words'

/**
 * The reviews a product page publishes as structured data (schema.org
 * `Product`/`ProductGroup` reviews, `Review` and `AggregateRating` in
 * `application/ld+json` scripts), which review apps such as Judge.me,
 * Yotpo or Okendo add for search engines. Only what the page itself
 * states: no script is run, no other host is asked.
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
 * that cannot be read or lies outside its scale.
 */
function stars(r: Record<string, Json>): {
  rating: number | null
  unclear: boolean
} {
  if (r.reviewRating === undefined || r.reviewRating === null)
    return { rating: null, unclear: false }
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
    return { rating: null, unclear: true }
  if (value < worst || value > best) return { rating: null, unclear: true }
  const five = 1 + ((value - worst) / (best - worst)) * 4
  return { rating: Math.round(five), unclear: false }
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

function scripts(html: string): string[] {
  const found: string[] = []
  let size = 0
  const walk = (n: Node) => {
    if (found.length >= maxScripts || size >= maxScriptChars) return
    if (
      isElement(n) &&
      n.tagName === 'script' &&
      (attr(n, 'type') ?? '').trim().toLowerCase() === 'application/ld+json'
    ) {
      const body = children(n)
        .map((c) => ('value' in c ? String(c.value) : ''))
        .join('')
      if (size + body.length <= maxScriptChars) {
        found.push(body)
        size += body.length
      }
      return
    }
    for (const c of children(n)) walk(c)
  }
  walk(parse(html.slice(0, 2_000_000)))
  return found
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
 */
export function pageReviews(
  html: string,
  url: string,
  now = Date.now()
): PageReviews {
  const reviews: Omit<ReadReview, 'id'>[] = []
  const seen = new Set<string>()
  const add = (r: Record<string, Json>, product: string | null) => {
    const words = fold(text(r.reviewBody) || text(r.description))
    if (!words) return
    const author = wellFormed(fold(text(r.author)).slice(0, 80))
    const key = `${author.toLowerCase()}\n${words.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    const { rating, unclear } = stars(r)
    reviews.push({
      author,
      text: wellFormed(words.slice(0, maxReviewText)),
      rating,
      ratingUnclear: unclear,
      date: day(r.datePublished, now),
      url,
      product
    })
  }
  for (const body of scripts(html)) {
    let data: Json
    try {
      data = JSON.parse(body)
    } catch {
      continue
    }
    for (const o of objects(data)) {
      if (isProduct(o)) {
        const name = wellFormed(fold(text(o.name)).slice(0, 120)) || null
        for (const r of [o.review].flat()) if (isObj(r)) add(r, name)
      } else if (types(o).includes('Review')) {
        const items = [o.itemReviewed].flat().filter(isObj)
        // Only a review of a product (or of nothing typed, on a product
        // page): never one that says it is of a shop or a company.
        if (items.some((i) => types(i).length && !isProduct(i))) continue
        const item = items[0] ?? o.itemReviewed
        add(o, wellFormed(fold(text(item)).slice(0, 120)) || null)
      }
    }
  }
  const loaded = apps.filter(([pattern]) => pattern.test(html))
  return {
    reviews,
    platform: loaded.length === 1 ? { name: loaded[0]![1], url } : null
  }
}
