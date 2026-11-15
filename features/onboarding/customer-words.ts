import { defaultBannedClaims } from '@/features/copy-qa/check'
import type { Finding } from '@/features/onboarding/findings'

/**
 * Customer words (owner pick #61, ONB-061): the phrases customers use in
 * their reviews and comments, reused in copy. The Reviews + social reader
 * (ONB-105) stores each as a `customer_words` finding whose evidence is the
 * customer's exact words, already checked: no link, address, handle or
 * phone number, and no claim. This picks the ones a writer may reuse:
 * short, sure, never one a banned phrase or a general claim is in, each
 * once, the surest first.
 *
 * The writer uses them as the brand's own words ("the softest tee you'll
 * own"), never as a quote or with a customer's name: a quoted review is a
 * different thing (`quotable_review`, shown with its author and stars).
 */

/** At most this many phrases go to the writer. */
export const maxCustomerWords = 8
/** A phrase, not a review: longer quotes are left for `quotable_review`. */
export const maxPhraseLength = 80
/** A finding surer than this is used. */
export const minConfidence = 0.5

export type CustomerPhrase = {
  /** The customer's exact words. */
  phrase: string
  /** What the reader says it shows, in a plain sentence. */
  meaning: string
  source: 'reviews' | 'social'
  /** The page it was read on. */
  url: string
  confidence: number
}

const fold = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** The phrase as whole words inside a text, as copy QA matches it. */
function holds(text: string, phrase: string) {
  const p = fold(phrase)
  return p.length > 0 && ` ${fold(text)} `.includes(` ${p} `)
}

/** The customer's words without the quote marks around them. */
const unquoted = (text: string) =>
  text
    .trim()
    .replace(/^["“”'‘’«»]+|["“”'‘’«»]+$/g, '')
    .trim()

/**
 * The phrases a writer may reuse: `customer_words` findings from reviews or
 * comments, at least `minConfidence` sure, at most `maxPhraseLength`
 * characters, none holding one of `banned` (the brand facts' banned list)
 * or a general claim, each once (a phrase inside a surer one is left out),
 * the surest first, reviews before comments, then the shorter.
 * A sample-rules finding is not used for a live workspace.
 */
export function customerWords(
  findings: readonly Finding[],
  {
    banned = [],
    live = false,
    max = maxCustomerWords
  }: { banned?: readonly string[]; live?: boolean; max?: number } = {}
): CustomerPhrase[] {
  const blocked = [...banned, ...defaultBannedClaims]
  const candidates = findings.flatMap((f): CustomerPhrase[] => {
    if (f.topic !== 'customer_words') return []
    if (f.source !== 'reviews' && f.source !== 'social') return []
    if (f.confidence < minConfidence || (live && f.pass === 'sample')) return []
    if (!('quote' in f.evidence)) return []
    const phrase = unquoted(f.evidence.quote)
    const length = Array.from(phrase).length
    if (length < 3 || length > maxPhraseLength || !/\p{L}/u.test(phrase))
      return []
    if (blocked.some((b) => holds(phrase, b))) return []
    return [
      {
        phrase,
        meaning: f.statement,
        source: f.source,
        url: f.evidence.url,
        confidence: f.confidence
      }
    ]
  })
  candidates.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      (a.source === b.source ? 0 : a.source === 'reviews' ? -1 : 1) ||
      a.phrase.length - b.phrase.length ||
      a.phrase.localeCompare(b.phrase)
  )
  const kept: CustomerPhrase[] = []
  for (const c of candidates) {
    if (kept.length >= max) break
    if (
      kept.some((k) => holds(k.phrase, c.phrase) || holds(c.phrase, k.phrase))
    )
      continue
    kept.push(c)
  }
  return kept
}

/**
 * One line for the writer's brief, or null when there are none. The words
 * are reused as the brand's own, never quoted or put in a customer's name.
 */
export function customerWordsBrief(phrases: readonly CustomerPhrase[]) {
  if (!phrases.length) return null
  const list = phrases.map((p) => `"${p.phrase}"`).join(', ')
  return `Words customers use about this brand: ${list}. Reuse them where they fit, as the brand's own words. Never present them as a quote or name a customer.`
}
