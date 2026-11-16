import { EMAIL_WIDTH } from '@/features/blocks/render'
import { footerProblems } from '@/features/klaviyo-push/html'
import { gmailClipBytes } from '@/features/release-qa/checks'
import { drawnText } from './drawn-text'

/**
 * DST-005 part 1: the hard checks on a built email's HTML, in the real
 * build path (the design step), before it is stored. Each problem is a
 * plain sentence. They check what the email is as drawn, never the draft:
 * the studio's pictures and the coded blocks alike.
 *
 * - Weight: under Gmail's 102 KB, with room for Klaviyo's tracking links.
 * - Width: nothing in the markup wider than the 600 px email.
 * - Alt text: every picture has its words (read with pictures off).
 * - Links: every link is https or mailto, or one of Klaviyo's tags; never
 *   empty, `#` or http; at least one to the store.
 * - The footer: Klaviyo's unsubscribe, preferences, web view, brand name
 *   and address tags (as the push checks them).
 * - The offer: no discount drawn (in the text or a picture's alt) above
 *   the owner's max, read as copy QA reads one (its words around the
 *   percent; product names and approved claims left out).
 *
 * Contrast is kept by construction: the blocks draw text in a colour
 * readable on its background (WCAG 4.5, 3 for large text, `readableOn`),
 * and the Design critic scores a studio picture's contrast.
 */

export type HardCheck =
  'weight' | 'width' | 'alt' | 'links' | 'footer' | 'offer'

export type HardProblem = { check: HardCheck; problem: string }

/** Klaviyo's tracking links add bytes after us (as the A/B test keeps). */
const clipMarginBytes = 10 * 1024

/** Copy QA's discount words, before and after a percent (`checkCopy`). */
const discountBefore =
  /(\b(save|saving|savings|up to|extra|take|get|enjoy|unlock)|[-−])\s*$/i
const discountAfter = /^\s*-?\s*(off|discount|sale|savings|saving)\b/i

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The words that may hold a percent that is no offer (copy QA's mask). */
function masked(text: string, known: readonly string[]) {
  let out = text
  for (const phrase of [...known]
    .map((p) => drawnText(p))
    .filter((p) => p.length > 1)
    .sort((a, b) => b.length - a.length))
    out = out.replace(new RegExp(escapeRegex(phrase), 'gi'), ' ')
  return out
}

const tags = (html: string) =>
  [...html.replace(/<!--[\s\S]*?-->/g, ' ').matchAll(/<[a-z][^>]*>/gi)].map(
    ([tag]) => tag
  )
const altOf = (tag: string) => /\balt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? ''

/** A link a reader may follow, or one of Klaviyo's own tags. */
function linkOk(href: string) {
  const h = drawnText(href)
  if (/^\{%\s*(unsubscribe|manage_preferences|web_view)\s*%\}$/.test(h))
    return true
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return true
  try {
    const u = new URL(h)
    return u.protocol === 'https:' && !u.username && !u.password
  } catch {
    return false
  }
}
const hostOf = (href: string) => {
  try {
    return new URL(drawnText(href)).hostname.toLowerCase()
  } catch {
    return null
  }
}
const atStore = (host: string, store: readonly string[]) =>
  store.some((s) => host === s || host.endsWith(`.${s}`))

export function hardProblems(
  html: string,
  input: {
    maxDiscountPercent: number
    /** Product names, approved claims, the brand's name: never an offer. */
    known?: readonly string[]
    /** The store's hosts (its site, its products'); none: any https link. */
    storeHosts?: readonly string[]
  }
): HardProblem[] {
  const problems: HardProblem[] = []
  const add = (check: HardCheck, problem: string) =>
    problems.push({ check, problem })
  const bytes = Buffer.byteLength(html, 'utf8')
  if (bytes >= gmailClipBytes - clipMarginBytes)
    add(
      'weight',
      `The email is ${Math.ceil(bytes / 1024)} KB; Gmail cuts off emails over 102 KB (Klaviyo's links add about 10 KB).`
    )
  const markup = tags(html)
  const wide = markup
    .flatMap((tag) => [
      ...tag.matchAll(/\swidth\s*=\s*"(\d+)(?:px)?"/gi),
      ...tag.matchAll(/(?:^|[;"\s])(?:min-)?width\s*:\s*(\d+)px/gi)
    ])
    .map((m) => Number(m[1]))
    .filter((w) => w > EMAIL_WIDTH)
  if (wide.length)
    add(
      'width',
      `Something is ${Math.max(...wide)} px wide; the email is ${EMAIL_WIDTH}.`
    )
  const pictures = markup.filter((tag) => /^<img\b/i.test(tag))
  const bare = pictures.filter((tag) => !drawnText(altOf(tag))).length
  if (bare)
    add(
      'alt',
      `${bare} picture${bare === 1 ? ' has' : 's have'} no words for when pictures are off.`
    )
  const links = markup
    .filter((tag) => /^<a\b/i.test(tag))
    .map((tag) => /\bhref\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '')
  const broken = links.filter((h) => !linkOk(h)).length
  const store = (input.storeHosts ?? []).map((h) => h.toLowerCase())
  const toStore = links.some((h) => {
    const host = linkOk(h) && /^https:/i.test(drawnText(h)) ? hostOf(h) : null
    return host !== null && (!store.length || atStore(host, store))
  })
  if (!toStore) add('links', 'The email has no link to the store.')
  if (broken)
    add(
      'links',
      `${broken} link${broken === 1 ? ' is' : 's are'} not a safe https link.`
    )
  for (const problem of footerProblems(html)) add('footer', problem)
  // What a reader sees, the pictures' words with it, as copy QA reads it.
  const seen = masked(
    [drawnText(html), ...pictures.map((tag) => drawnText(altOf(tag)))]
      .join(' ')
      .replace(/(\d+(?:[.,]\d+)?)\s*percent\b/gi, '$1%'),
    input.known ?? []
  )
  const max = input.maxDiscountPercent
  const over: number[] = []
  for (const m of seen.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) {
    const before = seen.slice(Math.max(0, m.index - 14), m.index)
    const after = seen.slice(m.index + m[0].length, m.index + m[0].length + 14)
    const value = Number(m[1]!.replace(',', '.'))
    if (
      (discountBefore.test(before) || discountAfter.test(after)) &&
      value > max
    )
      over.push(value)
  }
  if (over.length)
    add(
      'offer',
      max <= 0
        ? `The email shows ${Math.max(...over)}% though no discount is allowed.`
        : `The email shows ${Math.max(...over)}%, over your max of ${max}%.`
    )
  return problems
}
