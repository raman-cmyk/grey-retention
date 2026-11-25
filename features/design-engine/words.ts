import type { PartRole } from './blueprint'

/**
 * DES-ENGINE-002, the brand swap's words. A library email keeps its
 * structure, never its words (rule 8): each text slot (a headline, a
 * paragraph, a button, a caption) gets the brand's own words, written by
 * the email build's writers (the Copywriter, or the plain facts-only copy
 * when the AI is off) and handed in here as pools by role. Each slot takes
 * the words that fit its role and its length best: the slot's own number
 * of characters, so the text breaks onto as many lines as the original's
 * (the drawing loop then cuts a word or two where a font is wider).
 *
 * A writer's words that state a discount the email does not give, a
 * percent above the max, or a code that is not the email's own are never
 * used (rule 6, rule 7).
 */

export type WordPools = {
  headline: readonly string[]
  subheadline?: readonly string[]
  eyebrow?: readonly string[]
  body: readonly string[]
  button: readonly string[]
  caption?: readonly string[]
}

/** Which pools a role reads, first choice first. */
const poolsFor: Partial<Record<PartRole, (keyof WordPools)[]>> = {
  headline: ['headline', 'subheadline'],
  subheadline: ['subheadline', 'headline'],
  eyebrow: ['eyebrow', 'caption', 'headline'],
  body: ['body'],
  caption: ['caption', 'body'],
  footer_text: ['caption', 'body'],
  link: ['button'],
  main_button: ['button'],
  secondary_button: ['button']
}

/** What the words of an email may say about money: only its own offer. */
export type WordRules = {
  /** The email's offer: its code and percent, or none. */
  offer: { code: string; percent: number } | null
  maxDiscountPercent: number
}

const percents = /(\d{1,3}(?:[.,]\d+)?)\s?(?:%|percent\b|per cent\b)/gi
const codeLike = /\b[A-Z][A-Z0-9]*\d[A-Z0-9]*\b|\b[A-Z0-9]{5,}\b/g
const money = String.raw`(?:[$€£¥₹]\s?\d[\d.,]*|\d[\d.,]*\s?(?:[$€£¥₹]|usd|eur|gbp|aud|cad|dollars?|euros?|pounds?)\b)`
/** "$10 off", "Save $10", "take €5", "£5 discount": money off the price. */
const moneyOff = new RegExp(
  String.raw`${money}\s*(?:off|discount|back|less)\b|\b(?:save|take|get|knock)\s+(?:up\s+to\s+)?${money}`,
  'i'
)
/** Offers no code gives: half price, buy one get one, two for one. */
const otherOffers =
  /\bhalf[\s-]+(?:off|price)\b|\bbogo\b|\bbuy\s+(?:one|1|two|2)\s*,?\s*get\s+(?:one|1)\b|\b(?:two|2|three|3)\s+for\s+(?:one|1|two|2)\b|\b(?:b1g1|bxgy)\b/i
/** A code named in words: "use code X", "code: x", "coupon X", "promo X". */
const namedCode =
  /\b(?:code|coupon|promo(?:\s+code)?)\s*[:=]?\s*["'“]?([A-Za-z0-9][A-Za-z0-9_-]{2,})/gi

/**
 * Words an email with these rules may say about money (rules 6 and 7):
 * a percent only when it is the email's own offer within the max; no
 * money off, half price or buy-one-get-one; a code only when it is the
 * email's own (any case).
 */
export function wordsAllowed(words: string, rules: WordRules): boolean {
  const offer = rules.offer
  const offerOk =
    !!offer &&
    Number.isInteger(offer.percent) &&
    offer.percent >= 1 &&
    offer.percent <= rules.maxDiscountPercent
  for (const m of words.matchAll(percents)) {
    const n = Number(m[1]!.replace(',', '.'))
    if (!offerOk || n !== offer!.percent) return false
  }
  if (moneyOff.test(words) || otherOffers.test(words)) return false
  for (const m of words.matchAll(namedCode)) {
    const code = m[1]!.toUpperCase()
    // "Use code at checkout" names no code.
    if (/^(?:AT|IN|ON|FOR|TO|THE|AND|OR|BELOW|ABOVE|HERE|WHEN)$/.test(code))
      continue
    if (!offerOk || code !== offer!.code.toUpperCase()) return false
  }
  for (const m of words.matchAll(codeLike))
    if (/\d/.test(m[0]) && (!offerOk || m[0] !== offer!.code)) return false
  return true
}

/**
 * Words that carry a fact or a condition: a number, a percent, money, a
 * code, or a word that limits an offer (over, until, only, when, minimum,
 * first order, ends, excludes…). Cutting such words could change what
 * they promise ("Free shipping on orders over $50" → "Free shipping"), so
 * they are used whole or not at all.
 */
const conditions =
  /\d|%|[$€£¥₹]|\b(?:over|under|until|till|only|when|while|minimum|min|max|maximum|first\s+order|ends?|ending|expires?|excludes?|excluding|exclusions?|except|valid|limit(?:ed)?|code|coupon|promo|off|free|save|sale)\b/i
export const holdsFacts = (words: string) => conditions.test(words)

/** Words cut at a space to at most `max` characters (one word at least). */
export function cutTo(text: string, max: number): string {
  if (text.length <= max) return text
  const words = text.split(' ')
  let out = words[0]!
  for (const w of words.slice(1)) {
    if (out.length + 1 + w.length > max) break
    out += ` ${w}`
  }
  return out.replace(/[\s,;:–—-]+$/, '')
}

/** Whole texts after `start`, while they fit in `max` characters (never a part of one). */
function joinWithin(start: string, texts: readonly string[], max: number) {
  let out = start
  for (const w of texts) {
    if (out.includes(w)) continue
    // Texts joined as sentences: one without an end gets a full stop.
    const next = out ? `${/[.!?…]$/.test(out) ? out : `${out}.`} ${w}` : w
    if (next.length <= max) {
      out = next
      continue
    }
    break
  }
  return out
}

/**
 * Hands out the brand's words slot by slot. The same pools and slots
 * always give the same words; a text is used once while unused ones are
 * left, then again from the start. A text that carries a fact or a
 * condition (`holdsFacts`) is never cut: a slot too short for it takes
 * another text, or none (the section is then built from a library block).
 */
export function wordPicker(pools: WordPools, rules: WordRules) {
  const used = new Set<string>()
  const clean = (list: readonly string[] | undefined) =>
    (list ?? [])
      .map((w) => w.replace(/\s+/g, ' ').trim())
      .filter((w) => w && wordsAllowed(w, rules))
  const lists: Record<keyof WordPools, string[]> = {
    headline: clean(pools.headline),
    subheadline: clean(pools.subheadline),
    eyebrow: clean(pools.eyebrow),
    body: clean(pools.body),
    button: clean(pools.button),
    caption: clean(pools.caption)
  }
  const candidates = (role: PartRole) =>
    (poolsFor[role] ?? ['body']).flatMap((k) => lists[k])
  /** The best text of the role for a slot of `chars` characters, or null. */
  const pick = (role: PartRole, chars: number): string | null => {
    const max = Math.max(4, Math.round(chars * 1.05))
    // A text with a fact or a condition only where it fits whole.
    const all = candidates(role).filter(
      (w) => !holdsFacts(w) || w.length <= max
    )
    if (!all.length) return null
    const fresh = all.filter((w) => !used.has(w))
    const from = fresh.length ? fresh : all
    // Closest in length without going far over; shorter beats longer.
    const score = (w: string) =>
      w.length > chars * 1.1
        ? (w.length - chars) * 3
        : Math.abs(chars - w.length)
    const best = [...from].sort(
      (a, b) => score(a) - score(b) || from.indexOf(a) - from.indexOf(b)
    )[0]!
    used.add(best)
    let out = best.length > max ? cutTo(best, max) : best
    // A long paragraph slot takes more of the brand's sentences, whole.
    if ((role === 'body' || role === 'caption') && out.length < chars * 0.9) {
      const longer = joinWithin(out, [...from, ...all], max)
      for (const w of [...from, ...all]) if (longer.includes(w)) used.add(w)
      out = longer
    }
    return out
  }
  /**
   * More of the role's words after `text`, for a slot `chars` long whose
   * words broke onto fewer lines than the original's: whole texts of the
   * role not in it yet (a text with a fact never cut), or null when none.
   */
  const more: Lengthen = (role, text, chars) => {
    const max = Math.max(4, Math.round(chars * 1.05))
    const out = joinWithin(text, candidates(role), max)
    if (out === text) return null
    for (const w of candidates(role)) if (out.includes(w)) used.add(w)
    return out
  }
  return { pick, more }
}

/** More words for a slot of `role`, `chars` long, after `text` (or null). */
export type Lengthen = (
  role: PartRole,
  text: string,
  chars: number
) => string | null
