import { statedFact } from '@/features/strategy/words'
import { fold } from './site/pages'

/**
 * Checks the onboarding readers share on what a model says about a
 * source's own words (ONB-104 ads, ONB-105 reviews and comments).
 */

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The quote as the source writes it (its own capitals) from one of its
 * texts, whitespace and case aside; null when no one text says it.
 */
export function asWritten(texts: string[], quote: string): string | null {
  const pattern = new RegExp(escaped(fold(quote)), 'i')
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
