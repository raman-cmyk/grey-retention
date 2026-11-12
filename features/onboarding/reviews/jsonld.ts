import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import {
  maxReviewText,
  type PlatformRating,
  type ReadReview
} from '@/lib/providers/review-source'

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
const isProduct = (v: Record<string, Json>) =>
  types(v).some((t) => t === 'Product' || t === 'ProductGroup')
const text = (v: Json) =>
  typeof v === 'string'
    ? v
    : typeof v === 'number'
      ? String(v)
      : isObj(v) && typeof v.name === 'string'
        ? v.name
        : ''

const named: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  ndash: '–',
  mdash: '—'
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
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all
      }
      return named[code.toLowerCase()] ?? all
    }
  )
/**
 * The words a reader sees: entities decoded, whole tags taken out (`<br>`
 * becomes a space; text such as "I <3 it" is kept), hidden characters out,
 * one space.
 */
export const fold = (s: string) =>
  decoded(s)
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi, ' ')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const number = (v: Json) => {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN
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
    const author = fold(text(r.author)).slice(0, 80)
    const key = `${author.toLowerCase()}\n${words.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    const { rating, unclear } = stars(r)
    reviews.push({
      author,
      text: words.slice(0, maxReviewText),
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
        const name = fold(text(o.name)).slice(0, 120) || null
        for (const r of [o.review].flat()) if (isObj(r)) add(r, name)
      } else if (types(o).includes('Review')) {
        const item = isObj(o.itemReviewed) ? o.itemReviewed : null
        // Only a review of a product (or of nothing named, on a product page).
        if (item && types(item).length && !isProduct(item)) continue
        add(o, item ? fold(text(item)).slice(0, 120) || null : null)
      }
    }
  }
  const loaded = apps.filter(([pattern]) => pattern.test(html))
  return {
    reviews,
    platform: loaded.length === 1 ? { name: loaded[0]![1], url } : null
  }
}
