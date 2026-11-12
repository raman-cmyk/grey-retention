import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import {
  maxReviewText,
  type PlatformRating,
  type ReadReview
} from '@/lib/providers/review-source'

/**
 * The reviews a product page publishes as structured data (schema.org
 * `Product.review`, `Review` and `AggregateRating` in `application/ld+json`
 * scripts), which review apps such as Judge.me, Yotpo or Okendo add for
 * search engines. Only what the page itself states: no script is run, no
 * other host is asked.
 */

type Node = T.ChildNode | T.ParentNode
const isElement = (n: Node): n is T.Element => 'tagName' in n
const children = (n: Node): T.ChildNode[] =>
  'childNodes' in n ? n.childNodes : []
const attr = (n: T.Element, name: string) =>
  n.attrs.find((a) => a.name === name)?.value ?? null

/** Most structured-data scripts read per page, and the size of each. */
const maxScripts = 12
const maxScriptChars = 300_000

/** The review apps a page names, by a word in its markup. */
const apps: [RegExp, string][] = [
  [/judge\.?me/i, 'Judge.me'],
  [/yotpo/i, 'Yotpo'],
  [/okendo/i, 'Okendo'],
  [/stamped\.io|stamped-reviews/i, 'Stamped'],
  [/loox/i, 'Loox'],
  [/reviews\.io/i, 'REVIEWS.io'],
  [/trustpilot/i, 'Trustpilot']
]

type Json = unknown
const isObj = (v: Json): v is Record<string, Json> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const types = (v: Record<string, Json>) =>
  [v['@type']].flat().filter((t): t is string => typeof t === 'string')
const text = (v: Json) =>
  typeof v === 'string'
    ? v
    : typeof v === 'number'
      ? String(v)
      : isObj(v) && typeof v.name === 'string'
        ? v.name
        : ''
const fold = (s: string) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const number = (v: Json) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const day = (v: Json) => {
  if (typeof v !== 'string') return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim())
  return m && !Number.isNaN(Date.parse(m[1]!)) ? m[1]! : null
}

/** Every object in a structured-data value: arrays and `@graph` opened. */
function* objects(v: Json, depth = 0): Generator<Record<string, Json>> {
  if (depth > 6) return
  if (Array.isArray(v)) {
    for (const x of v) yield* objects(x, depth + 1)
    return
  }
  if (!isObj(v)) return
  yield v
  if (Array.isArray(v['@graph'])) yield* objects(v['@graph'], depth + 1)
}

function scripts(html: string): string[] {
  const found: string[] = []
  const walk = (n: Node) => {
    if (found.length >= maxScripts) return
    if (
      isElement(n) &&
      n.tagName === 'script' &&
      (attr(n, 'type') ?? '').trim().toLowerCase() === 'application/ld+json'
    ) {
      const body = children(n)
        .map((c) => ('value' in c ? String(c.value) : ''))
        .join('')
      if (body.length <= maxScriptChars) found.push(body)
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
 * The reviews and the rating a page states in its structured data, each
 * review with its author as shown, its words, its stars and day when
 * given. A review with no words is left out.
 */
export function pageReviews(html: string, url: string): PageReviews {
  const reviews: Omit<ReadReview, 'id'>[] = []
  let aggregate: { rating: number | null; count: number | null } | null = null
  const add = (r: Record<string, Json>, product: string | null) => {
    const words = fold(text(r.reviewBody) || text(r.description))
    if (!words) return
    const stars = isObj(r.reviewRating)
      ? number(r.reviewRating.ratingValue)
      : null
    reviews.push({
      author: fold(text(r.author)).slice(0, 80),
      text: words.slice(0, maxReviewText),
      rating:
        stars !== null && stars >= 1 && stars <= 5 ? Math.round(stars) : null,
      date: day(r.datePublished),
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
      const kinds = types(o)
      if (kinds.includes('Product')) {
        const name = fold(text(o.name)).slice(0, 120) || null
        for (const r of [o.review].flat()) if (isObj(r)) add(r, name)
        if (isObj(o.aggregateRating))
          aggregate = {
            rating: number(o.aggregateRating.ratingValue),
            count: number(
              o.aggregateRating.reviewCount ?? o.aggregateRating.ratingCount
            )
          }
      } else if (kinds.includes('Review'))
        add(
          o,
          isObj(o.itemReviewed)
            ? fold(text(o.itemReviewed)).slice(0, 120) || null
            : null
        )
    }
  }
  const app = apps.find(([pattern]) => pattern.test(html))?.[1]
  const rating =
    aggregate?.rating !== null &&
    aggregate?.rating !== undefined &&
    aggregate.rating >= 0 &&
    aggregate.rating <= 5
      ? Math.round(aggregate.rating * 10) / 10
      : null
  const count =
    aggregate?.count !== null &&
    aggregate?.count !== undefined &&
    Number.isInteger(aggregate.count) &&
    aggregate.count >= 0
      ? aggregate.count
      : null
  return {
    reviews,
    platform: app && aggregate ? { name: app, rating, count, url } : null
  }
}
