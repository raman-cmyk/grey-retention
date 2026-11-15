import { wordProblems } from '@/features/assembly/assemble'
import { checkCopy, type BrandFacts } from '@/features/copy-qa/check'
import type { Finding } from '@/features/onboarding/findings'

/**
 * Customer words (owner pick #61, ONB-061): the words customers use in
 * their reviews and comments, for the writer to borrow. The Reviews +
 * social reader (ONB-105) stores each as a `customer_words` finding whose
 * evidence is the customer's exact words, free of links, addresses,
 * handles and phone numbers. Review text is anyone's words, so this keeps
 * only what any email could say as the brand:
 *
 * - what copy QA and the writer's own word checks would pass with the
 *   brand's real facts (no shipping, returns, guarantee, delivery or
 *   percent beyond them, no social proof, results, timings, founder story,
 *   banned phrase or general claim);
 * - never the customer speaking ("my go-to", "I love it"), a superlative
 *   ("the softest tee"), a before-and-after ("cleared my skin") or a name
 *   other than the brand's or its products';
 * - short, sure, each once, the surest first, at most 8.
 *
 * The writer gets the phrases as data and one fixed rule
 * (`customerWordsRule`): borrow their words and tone, never quote them.
 */

/** At most this many phrases go to the writer. */
export const maxCustomerWords = 8
/** A phrase, not a review: longer quotes are left for `quotable_review`. */
export const maxPhraseLength = 80
/** Findings at least this sure are used. */
export const minConfidence = 0.5

/** The writer's rule for the phrases (it goes with the rules, not the data). */
export const customerWordsRule =
  "customerWords are phrases real customers use. Borrow their words and tone where they fit; never quote them, never put them in a customer's mouth, and never turn them into a promise about results, speed or being the best."

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

/** The customer speaking: never the brand's voice. */
const firstPerson =
  /\b(?:i|i'm|i’m|i've|i’ve|i'd|i’d|i'll|i’ll|me|my|mine|myself)\b/i
/** A before-and-after or a body change: a results claim in the brand's mouth. */
const results =
  /\b(?:clear(?:s|ed)?|cure[sd]?|heal(?:s|ed)?|fix(?:es|ed)?|transform(?:s|ed)?|chang(?:es|ed)|lost|gain(?:s|ed)?|reduc(?:es|ed)|eras(?:es|ed)|remov(?:es|ed)|eliminat(?:es|ed)|revers(?:es|ed)|stopp?(?:s|ed)|prevent(?:s|ed)|saved|no more)\b/i
/** Ranking words: a superlative the brand cannot back. */
const ranking = /\b(?:most|least|ever|unlike any|nothing (?:else|like it))\b/i
/** Words ending in -est that rank nothing. */
const plainEst = new Set([
  'honest',
  'interest',
  'rest',
  'test',
  'guest',
  'forest',
  'west',
  'chest',
  'nest',
  'quest',
  'request',
  'suggest',
  'contest',
  'harvest',
  'modest',
  'protest',
  'digest',
  'invest',
  'earnest',
  'manifest',
  'crest',
  'zest',
  'vest',
  'pest',
  'fest'
])
const superlative = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .some((w) => w.length >= 5 && w.endsWith('est') && !plainEst.has(w))

/** A capitalised word after the first, other than "I" and the allowed names. */
function namesSomeone(text: string, names: readonly string[]) {
  let rest = text
  for (const name of [...names].sort((a, b) => b.length - a.length))
    if (name.trim().length > 1) rest = rest.split(name.trim()).join(' ')
  const words = rest.split(/\s+/).filter(Boolean)
  return words
    .slice(1)
    .some((w) => /^\p{Lu}/u.test(w) && !/^I(?:'|’|$)/.test(w))
}

/** The customer's words, without a pair of quote marks around them. */
function unquoted(text: string) {
  const t = text.trim()
  const pairs: Record<string, string> = {
    '"': '"',
    '“': '”',
    '«': '»',
    '‘': '’',
    "'": "'"
  }
  const close = pairs[t[0] ?? '']
  return close && t.length > 1 && t.endsWith(close) ? t.slice(1, -1).trim() : t
}

const fold = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
/** One phrase inside another, as whole words. */
const inside = (text: string, phrase: string) =>
  ` ${fold(text)} `.includes(` ${fold(phrase)} `)

/** Whether copy QA and the writer's checks pass the phrase as a line of copy. */
function passesChecks(phrase: string, facts: BrandFacts) {
  const qa = checkCopy({
    draft: { subject: '', preview: '', blocks: [{ id: 'w', text: phrase }] },
    facts,
    maxDiscountPercent: null,
    codes: [],
    productNames: [],
    sendAt: '2026-01-01T00:00:00.000Z'
  })
  if (!qa.pass) return false
  const written = wordProblems(
    {
      subject: '',
      preheader: '',
      blocks: [{ type: 'text', reason: '', words: { body: phrase } }]
    },
    {
      brief: { campaignType: 'check', goal: 'check' },
      products: [],
      codes: [],
      maxDiscountPercent: 0,
      sendAt: '2026-01-01T00:00:00.000Z',
      timezone: 'UTC',
      facts
    },
    { productIds: [], offerShown: false }
  )
  return written.length === 0
}

/**
 * The phrases a writer may borrow: `customer_words` findings from reviews
 * or comments, at least `minConfidence` sure, 3 to `maxPhraseLength`
 * characters with a letter, passing every check above with the brand's
 * `facts` (its banned list included); `names` are the brand's and its
 * products' (a capitalised word other than these may be someone's name).
 * Each once (a phrase holding a surer or shorter one is left out), the
 * surest first, reviews before comments, then the shorter.
 */
export function customerWords(
  findings: readonly Finding[],
  options: {
    facts: BrandFacts
    /** True for a workspace read live: a sample-rules finding never counts. */
    live: boolean
    names?: readonly string[]
    max?: number
  }
): CustomerPhrase[] {
  const max = Number.isInteger(options.max)
    ? Math.min(Math.max(options.max!, 0), maxCustomerWords)
    : maxCustomerWords
  const candidates = findings.flatMap((f): CustomerPhrase[] => {
    if (f.topic !== 'customer_words') return []
    if (f.source !== 'reviews' && f.source !== 'social') return []
    if (f.confidence < minConfidence) return []
    if (options.live && f.pass === 'sample') return []
    if (!('quote' in f.evidence)) return []
    const phrase = unquoted(f.evidence.quote)
    const length = Array.from(phrase).length
    if (length < 3 || length > maxPhraseLength || !/\p{L}/u.test(phrase))
      return []
    if (
      firstPerson.test(phrase) ||
      results.test(phrase) ||
      ranking.test(phrase) ||
      superlative(phrase) ||
      namesSomeone(phrase, options.names ?? []) ||
      !passesChecks(phrase, options.facts)
    )
      return []
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
      kept.some((k) => inside(k.phrase, c.phrase) || inside(c.phrase, k.phrase))
    )
      continue
    kept.push(c)
  }
  return kept
}

/** What the writer's data gets: the phrases alone (JSON keeps them data). */
export const customerWordsData = (phrases: readonly CustomerPhrase[]) =>
  phrases.map((p) => p.phrase)
