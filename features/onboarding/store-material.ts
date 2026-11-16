import { hiddenChars, oneLine } from '@/features/assembly/assemble'
import { hostOf } from '@/features/brand-profile/mismatch'
import type { AssemblyInput, ConfirmedReview } from '@/features/assembly/inputs'
import { checkCopy, type BrandFacts } from '@/features/copy-qa/check'
import { strayPrices, typedLink } from '@/features/email-build/inspect'
import { maxNoteWords } from '@/features/letter/kinds'
import { wordCount } from '@/features/letter/letter'
import type { Correction } from './brand-book-corrections'
import { bodyWords, resultWords } from './customer-words'
import type { Finding } from './findings'
import { claims, plain } from './words'

/**
 * REL-ONB2 part a: the store's own material for the blocks of "Create email",
 * only from what its readers kept. Never written by AI, never the sample's
 * for a real store (a live workspace never counts a sample-rules finding),
 * and never from another website than the store's own:
 *
 * - Reviews (`review_strip`): the reviews an email may quote, chosen by
 *   code (`quotable_review`, ONB-105), with their own stars, their exact
 *   words (at most `maxQuote` characters, never cut) and the reviewer's
 *   first name and last initial (`reviewerName`). Only while the brand has
 *   a verified review source (copy QA's `reviewsVerified`): the strip
 *   shows each review's stars, and copy QA refuses stars without one.
 * - A note in the brand's own words (`founder_note`): whole sentences of
 *   its about page in its own voice (we, our, I), each standing alone, that
 *   the Site reader quoted (found word for word there, ONB-101), signed
 *   with the brand's name (no founder's name is read). Only lines the
 *   owner can see in the Brand book, and never one he removed or replaced
 *   there (ONB-058).
 * - A lifestyle photo (`hero_image`): part b, from the Site reader's
 *   photos (ONB-059b).
 * - Customer photos (`ugc_grid`): none. No reader keeps customers' own
 *   photos (the Site reader leaves review photos out), and a brand photo
 *   is never one.
 *
 * Every word is safe to show as the store's (`safe`: copy QA with its facts,
 * as the Brand inspector will judge it, and no claim, result or effect on
 * the body). Material with none of its source is absent, so its block
 * stays disallowed (`allowedBlockTypes`).
 */

/** The longest review quoted, in characters (a longer one is left out). */
export const maxQuote = 200
/** Sentences of the about page one note takes, at most. */
export const maxNoteParas = 2
/** Findings at least this sure are used, as the facts' own. */
const minConfidence = 0.5

export type Material = NonNullable<AssemblyInput['confirmed']>

export type MaterialParts = {
  brandName: string
  /** The store's website, lower case, without `www.`. */
  host: string
  /** True for a workspace read live: a sample-rules finding never counts. */
  live: boolean
  findings: readonly Finding[]
  corrections: readonly Correction[]
  facts: BrandFacts
  productNames: readonly string[]
}

/** The store's own website, `www.` and subdomains aside (`mismatch.ts`'s rule). */
const ownSite = (url: string, host: string) => {
  const h = hostOf(url)
  return !!h && (h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`))
}

/** Store words as they are: one line, no markup, link, price or hidden character. */
const clean = (text: string) =>
  text.length > 0 &&
  text === oneLine(text, 2_000) &&
  !hiddenChars.test(text) &&
  !/[{}<>[\]\\]/.test(text) &&
  !typedLink.test(text) &&
  strayPrices(text, new Set()).length === 0

/**
 * Words an email may show as the store's: clean, no claim, result or
 * effect on the body (what customers' words never say either, ONB-061),
 * and passed by copy QA with the store's facts, as the Brand inspector
 * will judge them. Over-blocking is the safer mistake.
 */
const safe = (text: string, parts: MaterialParts, judged = text) =>
  clean(text) &&
  !claims.test(text) &&
  !resultWords.test(text) &&
  !bodyWords.test(text) &&
  passes(judged, parts)

const passes = (text: string, parts: MaterialParts) =>
  checkCopy({
    draft: { subject: '', preview: '', blocks: [{ id: 'material', text }] },
    facts: parts.facts,
    // No offer: a percent in a review or a note is never the email's.
    maxDiscountPercent: null,
    codes: [],
    productNames: [parts.brandName, ...parts.productNames],
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
  ownSite(f.evidence.url, parts.host)

const nameWord = /^\p{L}[\p{L}\p{M}'’-]*\.?$/u
const title = /^(?:dr|mr|mrs|ms|miss|mx|prof|sir|dame)\.?$/i
const noOne =
  /\b(?:verified|anonymous|anon|customer|buyer|reviewer|shopper|user|guest|team|admin|store|shop)\b/i

/**
 * A reviewer as an email names them: the first name and the initial of
 * the last ("Jordan Smith" is "Jordan S."), a one-word name as it is.
 * Null when it reads as no one's or holds more than letters: the review is
 * then left out, since an email never makes a name up.
 */
export function reviewerName(author: string): string | null {
  const all = author.trim().split(/\s+/)
  // A title is no first name ("Dr. Jane Smith" is "Jane S.").
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
      if (Array.from(quote).length > maxQuote) return []
      // Judged as the Brand inspector will (`copyDraftOf`: name and stars too).
      const shown = `${quote}\n${author}\nRated ${value.rating} out of 5`
      if (!safe(`${quote} ${author}`, parts, shown)) return []
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

/** The Brand book section a site finding's line is in (ONB-058 corrects it there). */
const sectionOf: Record<string, string> = {
  offering: 'offering',
  audience: 'customers.who',
  tone: 'voice'
}
const lineKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
/** A whole sentence: a capital (or a number) first, its full stop last. */
const sentence = /^["“‘']?[\p{Lu}\p{N}][\s\S]*[.!?]["”’']?$/u
/** The brand speaking for itself, so the note reads as its own. */
const ownVoice =
  /\b(?:we|we're|we’re|we've|we’ve|our|ours|us|i|i'm|i’m|my|me)\b/i
/** A sentence that leans on the one before it ("That shed…") stands alone nowhere. */
const leans =
  /^["“‘']?(?:that|this|these|those|it|its|they|their|them|he|she|his|her|so|and|but|or|then|also|since|which|there)\b/i

const disowned = (f: Finding, corrections: readonly Correction[]) =>
  corrections.some(
    (c) =>
      c.section === sectionOf[f.topic] &&
      c.action !== 'add' &&
      c.original !== null &&
      lineKey(c.original) === lineKey(f.statement)
  )

function note(parts: MaterialParts): Material['founder'] {
  const name = parts.brandName.trim()
  if (!name || name.length > 60 || !clean(name)) return undefined
  const lines = parts.findings
    .flatMap((f) => {
      if (f.source !== 'site' || !Object.hasOwn(sectionOf, f.topic)) return []
      if (!counts(f, parts) || f.evidence.page !== 'about') return []
      // A line the owner can see in the Brand book (and so correct).
      if (!plain(f.statement) || disowned(f, parts.corrections)) return []
      const text = f.evidence.quote.trim()
      return sentence.test(text) &&
        ownVoice.test(text) &&
        !leans.test(text) &&
        wordCount(text) >= 5 &&
        safe(text, parts)
        ? [{ text, confidence: f.confidence }]
        : []
    })
    .sort((a, b) => b.confidence - a.confidence || a.text.localeCompare(b.text))
  const kept: string[] = []
  let words = 0
  for (const { text } of lines) {
    if (kept.length >= maxNoteParas) break
    const key = lineKey(text)
    if (kept.some((k) => lineKey(k).includes(key) || key.includes(lineKey(k))))
      continue
    if (words + wordCount(text) > maxNoteWords) continue
    kept.push(text)
    words += wordCount(text)
  }
  return kept.length ? { name, note: kept } : undefined
}

/** The store's material, or undefined when it has none. Pure. */
export function storeMaterial(parts: MaterialParts): Material | undefined {
  const quoted = reviews(parts)
  const founder = note(parts)
  const material: Material = {
    ...(quoted.length ? { reviews: quoted } : {}),
    ...(founder ? { founder } : {})
  }
  return Object.keys(material).length ? material : undefined
}
