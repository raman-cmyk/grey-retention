/**
 * LRN-002 part b (D22's second source): do's and don'ts from the checks'
 * rejections. When the copy of several of a brand's emails kept failing
 * the same check, until the build gave up and used plain copy, the writers
 * are told not to do it again. Owner edits, D22's third source, are
 * learned by PIC-29 (`brand_never_words`, the phrases the owner takes
 * out), which every writer already reads. Pure: `./run` applies it.
 */

import { confidenceFor, minSends } from './patterns'

/** Only rejections this recent count (the copy may have changed since). */
export const rejectionDays = 60
/** A rejection rule ends after this time unless it is seen again. */
export const rejectionRuleDays = 90

/** The fallbacks whose `detail.rules` name the checks the copy failed. */
export const copyFallbackCodes = [
  'copy_plain_fallback',
  'copy_failed',
  'copy_check_failed'
]

/** One logged copy fallback: one email's copy that kept failing. */
export type CopyFallback = {
  id: string
  /** The rule keys the copy failed last (`detail.rules`). */
  rules: string[]
  lastSeenAt: string
}

/**
 * The checks worth a rule, in the writers' words: what the copy kept doing.
 * A check missing here (an internal one such as `writer_output`, or a
 * picture check) never becomes a rule.
 */
export const rejectionWords: Record<string, string> = {
  // The brand check (ASM-002 copy QA).
  discount_over_max: 'a discount above the brand’s maximum',
  discount_not_allowed: 'a discount where none is allowed',
  discount_no_code: 'a discount without its code',
  money_off: 'a money-off amount the brand does not offer',
  unknown_code: 'a code that is not one of the brand’s codes',
  expired_code: 'a code that has expired',
  code_over_max: 'a code worth more than the maximum discount',
  unsupported_percent: 'a percentage the brand does not offer',
  shipping_claim: 'shipping claims the brand facts do not support',
  delivery_promise: 'delivery promises the brand facts do not support',
  returns_claim: 'returns claims the brand facts do not support',
  guarantee_claim: 'guarantees the brand facts do not support',
  banned_phrase: 'words the brand has banned',
  unsupported_claim: 'claims the brand cannot back up',
  unverified_review: 'ratings or review counts without a verified source',
  // The email check (QAG-001 and the inspectors' code).
  spam_words: 'words that read as spam',
  subject_length: 'subject lines that are too long',
  subject_shouting: 'subject lines in capitals or with many exclamation marks',
  preview_length: 'preview lines that are too long',
  preview_repeats_subject: 'preview lines that repeat the subject',
  too_long: 'emails that are too long',
  one_action: 'more than one main action in an email',
  vague_link: 'vague link words such as "click here"',
  reading_level: 'sentences that are too hard to read',
  headline_too_long: 'headlines that are too long for their section',
  section_words: 'more words than a section has room for'
}

const writers = ['copywriter', 'letter-writer']

export type RejectionPattern = {
  check: string
  rule: string
  why: string
  appliesTo: string[]
  evidence: { fallbackId: string }[]
  confidence: number
}

/**
 * The checks the copy of at least `minSends` different emails kept failing
 * in the last `rejectionDays` days, each a "don't" for the writers.
 */
export function findRejections(
  fallbacks: readonly CopyFallback[],
  now: number
): RejectionPattern[] {
  const since = now - rejectionDays * 86_400_000
  const recent = fallbacks.filter((f) => {
    const t = Date.parse(f.lastSeenAt)
    return t >= since && t <= now
  })
  const byCheck = new Map<string, CopyFallback[]>()
  for (const f of recent)
    for (const check of new Set(f.rules))
      if (Object.hasOwn(rejectionWords, check))
        byCheck.set(check, [...(byCheck.get(check) ?? []), f])
  return [...byCheck]
    .filter(([, list]) => list.length >= minSends)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([check, list]) => ({
      check,
      rule: `Never write ${rejectionWords[check]}: the checks kept rejecting it in this brand's emails.`,
      why: `The copy of ${list.length} emails in the last ${rejectionDays} days kept failing this check until plain copy was used.`,
      appliesTo: writers,
      evidence: list.map((f) => ({ fallbackId: f.id })),
      confidence: confidenceFor(list.length)
    }))
}

/** The stable key of a rejection rule, per workspace. */
export const rejectionKey = (tenantId: string, check: string) =>
  `inspector:${tenantId}:${check}:dont`.slice(0, 200)
