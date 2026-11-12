import { statedFact } from '@/features/strategy/words'
import { fold } from './site/pages'

/**
 * Checks the onboarding readers share on what a model says about a
 * source's own words (ONB-104 ads, ONB-105 reviews and comments).
 */

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Half of an emoji or other pair with its other half missing. */
const loneHalf =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
/**
 * Text the database can store: a broken character pair (from a page's
 * `&#xD83D;` or a cut through an emoji) becomes the replacement character,
 * as a browser shows it.
 */
export const wellFormed = (s: string) => s.replace(loneHalf, '\uFFFD')

/** Scripts written without spaces between words: no word edge to check. */
const unspaced =
  '[\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Thai}\\p{sc=Lao}\\p{sc=Khmer}\\p{sc=Myanmar}]'
/** A letter, digit or mark of a script with spaces between words. */
const wordChar = `(?!${unspaced})[\\p{L}\\p{N}\\p{M}]`

/**
 * The quote as the source writes it (its own capitals) from one of its
 * texts, whitespace and case aside; null when no one text says it.
 */
export function asWritten(texts: string[], quote: string): string | null {
  // Whole words only: never a quote starting or ending inside a word (in
  // a script with spaces; Japanese, Chinese or Thai have no word edges).
  const pattern = new RegExp(
    `(?<!${wordChar})${escaped(fold(quote))}(?!${wordChar})`,
    'iu'
  )
  for (const field of texts.map(fold)) {
    const found = pattern.exec(field)
    if (found) return found[0]
  }
  return null
}

/** Words that make a claim a source would have to prove. */
export const claims =
  /\b(best|in the world|#1|number one|leading|award|guarantee|cheapest|finest|perfect|organic|natural|hand-?made|sustainab\w*|eco|vegan|cruelty|plastic|recycled|certified|clinical\w*|proven|non-toxic|toxic|safe|healthy|cure|heal\w*)\b/i

/** A sentence with no number, price, date or claim (the shared check). */
export const plain = (s: string) => statedFact(s) === null && !claims.test(s)
