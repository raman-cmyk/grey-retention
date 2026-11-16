import { hiddenChars, oneLine } from '@/features/assembly/assemble'
import type { AssemblyInput, ConfirmedReview } from '@/features/assembly/inputs'
import { hostOf } from '@/features/brand-profile/mismatch'
import { checkCopy, type BrandFacts } from '@/features/copy-qa/check'
import {
  phrase,
  spamPhrases,
  strayPrices,
  typedLink
} from '@/features/email-build/inspect'
import { onDomain } from '@/lib/providers/ad-library'
import { bodyWords, namesSomeone, resultWords } from './customer-words'
import type { Finding } from './findings'
import { claims } from './words'

/**
 * REL-ONB2 part a: the store's own reviews for the review strip of
 * "Create email", only from what its Reviews reader kept. Never written by
 * AI, never the sample's for a real store (a live workspace never counts a
 * sample-rules finding), never from another website than the store's own
 * (or one of its subdomains):
 *
 * - The reviews an email may quote, chosen by code (`quotable_review`,
 *   ONB-105), with their own stars, their exact words (at most `maxQuote`
 *   characters, never cut) and the reviewer's first name and last initial
 *   (`reviewerName`), best rated and newest first, at most 3.
 * - Only while the brand has a verified review source (copy QA's
 *   `reviewsVerified`): the strip shows each review's stars, and copy QA
 *   refuses stars without one.
 * - Never a quote naming someone (another customer, a member of staff, the
 *   reviewer themself), never spam words, and every word judged by copy QA
 *   at least as strictly as the Brand inspector will judge the email
 *   (`safe`), so the inspector never meets a review it cannot fix.
 *
 * Not here: customer photos (`ugc_grid`; no reader keeps customers' own
 * photos, and a brand photo is never one), a note in the brand's words
 * (`founder_note`; the Site reader does not yet mark a quote as a whole
 * sentence of the page in its own letters) and a lifestyle photo
 * (`hero_image`; part b). Without reviews the material is absent, so the
 * review strip stays disallowed (`allowedBlockTypes`).
 */

/** The longest review quoted, in characters (a longer one is left out). */
export const maxQuote = 200
/** Findings at least this sure are used, as the facts' own (`brand-facts.ts`). */
const minConfidence = 0.6

export type Material = NonNullable<AssemblyInput['confirmed']>

export type MaterialParts = {
  brandName: string
  /** The store's website, lower case, without `www.`. */
  host: string
  /** True for a workspace read live: a sample-rules finding never counts. */
  live: boolean
  findings: readonly Finding[]
  facts: BrandFacts
  /** The catalog's titles: capitalised words a quote may use (never a name). */
  productNames: readonly string[]
}

/** Store words as they are: one line, no markup, link, price or hidden character. */
const clean = (text: string) =>
  text.length > 0 &&
  text === oneLine(text, 2_000) &&
  !hiddenChars.test(text) &&
  !/[{}<>[\]\\]/.test(text) &&
  !typedLink.test(text) &&
  strayPrices(text, new Set()).length === 0

/** Each sentence on its own: its first word is capitalised as any sentence's. */
const sentences = (text: string) =>
  text.split(/(?<=[.!?…])\s+/).filter((s) => s.trim())

/**
 * Words an email may show as the store's: clean, no claim, result, effect
 * on the body (what customers' words never say either, ONB-061), spam
 * word or anyone's name (the brand's and its products' aside), and passed
 * by copy QA with the store's facts. Copy QA masks nothing here (no
 * product title, no brand name): the Brand inspector masks only the
 * products an email places, so this is at least as strict as it is.
 * Over-blocking is the safer mistake.
 */
const safe = (text: string, parts: MaterialParts, judged = text) =>
  clean(text) &&
  !claims.test(text) &&
  !resultWords.test(text) &&
  !bodyWords.test(text) &&
  !spamPhrases.some((s) => phrase(text, s)) &&
  !sentences(text).some((s) =>
    namesSomeone(s, [parts.brandName, ...parts.productNames])
  ) &&
  checkCopy({
    draft: {
      subject: '',
      preview: '',
      blocks: [{ id: 'material', text: judged }]
    },
    facts: parts.facts,
    // No offer: a percent in a review is never the email's.
    maxDiscountPercent: null,
    codes: [],
    productNames: [],
    sendAt: '2026-01-01T00:00:00.000Z'
  }).pass

type Quoted = Finding & {
  evidence: Extract<Finding['evidence'], { quote: string }>
}
/** A finding this store may use: sure, of its kind of read, quoting its own website. */
const counts = (f: Finding, parts: MaterialParts): f is Quoted =>
  f.confidence >= minConfidence &&
  !(parts.live && f.pass === 'sample') &&
  'quote' in f.evidence &&
  onDomain(hostOf(f.evidence.url), parts.host)

const nameWord = /^\p{L}[\p{L}\p{M}'’-]*\.?$/u
const title = /^(?:dr|mr|mrs|ms|miss|mx|prof|sir|dame)\.?$/i
/** Words that are no name: a placeholder, or a place or a pair ("from Leeds", "Kate and Sam", "Jr."). */
const noOne =
  /(?<![\p{L}\p{M}])(?:verified|anonymous|anon|customer|buyer|reviewer|shopper|user|guest|team|admin|store|shop|from|in|and|of|at|with|by|for|the|jr|sr|ii|iii|iv)(?![\p{L}\p{M}])/iu

/**
 * A reviewer as an email names them: the first name and the initial of
 * the last ("Jordan Smith" is "Jordan S.", "Dr. Jane Smith" is "Jane S."),
 * a one-word name as it is. Null when it reads as no one's, names a place
 * or two people, carries a suffix or holds more than letters: the review
 * is then left out, since an email never makes a name up.
 */
export function reviewerName(author: string): string | null {
  const all = author.trim().split(/\s+/)
  // A title is no first name.
  const words = all.length > 1 && title.test(all[0]!) ? all.slice(1) : all
  if (
    title.test(words[0]!) ||
    words.length > 4 ||
    noOne.test(author) ||
    !words.every((w) => nameWord.test(w)) ||
    Array.from(words[0]!).length > 30
  )
    return null
  if (words.length === 1) return words[0]!
  const initial = Array.from(words.at(-1)!)[0]!.toLocaleUpperCase()
  return `${words[0]} ${initial}.`
}

/** The reviewer's own name in their words ("Jordan here, …"). */
const signs = (quote: string, author: string) =>
  author
    .split(/\s+/)
    .map((w) => w.replace(/\.$/, ''))
    .filter((w) => Array.from(w).length >= 2 && !title.test(w))
    .some((w) => phrase(quote, w))

function reviews(parts: MaterialParts): ConfirmedReview[] {
  if (!parts.facts.reviewsVerified) return []
  const seen = new Set<string>()
  return parts.findings
    .flatMap((f) => {
      if (f.topic !== 'quotable_review' || f.source !== 'reviews') return []
      if (!counts(f, parts)) return []
      const value = f.value as {
        author: string
        rating?: number
        date?: string
      }
      const quote = f.evidence.quote
      const author = reviewerName(value.author)
      // The strip shows stars: a review without its own is never given some.
      if (!author || value.rating === undefined) return []
      if (Array.from(quote).length > maxQuote || signs(quote, value.author))
        return []
      // Judged as the Brand inspector will (`copyDraftOf`: name and stars too).
      const shown = `${quote}\n${author}\nRated ${value.rating} out of 5`
      if (!safe(quote, parts, shown) || claims.test(author)) return []
      const review = { quote, author, rating: value.rating }
      return [{ review, date: value.date ?? '' }]
    })
    .sort(
      (a, b) =>
        b.review.rating - a.review.rating ||
        b.date.localeCompare(a.date) ||
        a.review.quote.localeCompare(b.review.quote)
    )
    .filter(({ review }) => {
      const key = review.quote.toLowerCase()
      return !seen.has(key) && !!seen.add(key)
    })
    .slice(0, 3)
    .map(({ review }) => review)
}

/** The store's material, or undefined when it has none. Pure. */
export function storeMaterial(parts: MaterialParts): Material | undefined {
  const quoted = reviews(parts)
  return quoted.length ? { reviews: quoted } : undefined
}
