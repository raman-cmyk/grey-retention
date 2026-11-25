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

/** What the words of an email may say about money: only its own offer and the store's facts. */
export type WordRules = {
  /** The email's offer: its code and percent, or none. */
  offer: { code: string; percent: number } | null
  maxDiscountPercent: number
  /**
   * Money amounts the words may state: the catalog's prices (and sale
   * prices within the max), a free-shipping threshold, other approved
   * amounts. Any other amount is refused. The swap adds its products'.
   */
  amounts?: readonly string[]
  /**
   * The brand's approved claims, word for word ("Free shipping on orders
   * over $50", "Free gift with every order"): words holding one of them
   * say a fact, and only what is outside them is judged.
   */
  claims?: readonly string[]
}

const numberWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100
}
const spelled = `(?:${Object.keys(numberWords).join('|')})(?:[\\s-](?:${Object.keys(numberWords).join('|')}))?`
const spelledValue = (words: string) =>
  words
    .toLowerCase()
    .split(/[\s-]+/)
    .reduce((n, w) => n + (numberWords[w] ?? 0), 0)

/** A money amount as its value: "$1,299.00" → "1299", "€9,50" → "9.5". */
export function moneyValue(text: string): string | null {
  const digits = text.replace(/[^\d.,]/g, '')
  if (!digits) return null
  const normal = /^\d{1,3}(\.\d{3})+(,\d+)?$|^\d+,\d{1,2}$/.test(digits)
    ? digits.replace(/\./g, '').replace(',', '.')
    : digits.replace(/,/g, '')
  const n = Number(normal)
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : null
}

const currency = String.raw`(?:usd|eur|gbp|aud|cad|dollars?|euros?|pounds?|bucks)`
/** Money in digits ("$12", "12 USD", "€9,50") or spelled out ("ten dollars"). */
const moneyDigits = new RegExp(
  String.raw`[$€£¥₹]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:[$€£¥₹]|${currency}\b)`,
  'gi'
)
const moneySpelled = new RegExp(String.raw`\b${spelled}\s+${currency}\b`, 'gi')
const percentDigits = /(\d{1,3}(?:[.,]\d+)?)\s?(?:%|percent\b|per\s?cent\b)/gi
const percentSpelled = new RegExp(
  String.raw`\b(${spelled})\s+(?:percent|per\s?cent)\b`,
  'gi'
)
/** Words that make a percent a discount (as copy QA reads them). */
const discountBefore =
  /(?:\b(?:save|saving|savings|up to|extra|take|get|enjoy|unlock|flat|plus|additional|another)|[-−+])\s*$/i
const discountAfter =
  /^\s*-?\s*(?:off|discount|sale|savings?|reduction|cheaper|less|more|extra)\b/i
const moneyOff = new RegExp(
  String.raw`(?:[$€£¥₹]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:[$€£¥₹]|${currency})|\b${spelled}\s+${currency})\s*(?:off|discount|back|less|cheaper)\b|\b(?:save|take|get|knock)\s+(?:up\s+to\s+)?(?:[$€£¥₹]\s?\d|\d[\d.,]*\s?(?:[$€£¥₹]|${currency})|${spelled}\s+${currency})`,
  'i'
)
/** Sale wording: was/now, now only $X, prices from $X, reduced… */
const saleWords =
  /\bwas\b[^.!?]{0,30}\bnow\b|\bnow\s+(?:only\s+)?[$€£¥₹\d]|\bonly\s+[$€£¥₹]|\b(?:prices?\s+)?(?:from|starting\s+at)\s+(?:just\s+)?[$€£¥₹]|\b(?:reduced|markdowns?|marked\s+down|clearance|sale\s+price)\b/i
/** Offers no code gives: half price, buy N get M, N for $X, spend X get Y… */
const otherOffers = new RegExp(
  String.raw`\bhalf[\s-]+(?:off|price)\b|\bbogo\b|\bb\d+g\d+\b|\bbxgy\b|\bbuy\s+(?:\d+|${spelled}|any)\b[^.!?]{0,20}\bget\b|\b(?:\d+|${spelled})\s+for\s+(?:\d+|${spelled}|[$€£¥₹])|\bspend\s+[$€£¥₹]?\s?\d[^.!?]{0,30}\b(?:get|save|off)\b|\bgift\s+card\s+worth\b`,
  'i'
)
/** Promises that need a fact: free shipping, a free gift… */
const freeThings =
  /\bfree\s+(?:shipping|delivery|postage|returns?|gifts?|samples?|tote|bag|mini|trial)\b/i
/** A code named in words: "use code X", "code: x", "coupon X", "promo code X". */
const namedCode =
  /\b(?:code|coupon|promo\s+code|voucher)\s*[:=]?\s*["'“]?([A-Za-z0-9][A-Za-z0-9_-]{2,})|\bpromo\s*[:=]\s*["'“]?([A-Za-z0-9][A-Za-z0-9_-]{2,})/gi
/** Stock and scarcity claims no fact backs: "Only 5 left", "almost gone". */
const stockClaims =
  /\bonly\s+(?:\d+|a\s+few|few)\s+(?:left|remaining|in\s+stock)\b|\b\d+\s+left\s+in\s+stock\b|\b(?:low|limited)\s+stock\b|\bselling\s+(?:out|fast)\b|\balmost\s+(?:gone|sold\s+out)\b|\bsold\s+out\b|\bgoing\s+fast\b|\bwhile\s+(?:stocks?|supplies)\s+last\b/i
/** "Enter X at checkout", "apply x in checkout". */
const atCheckout =
  /\b(?:enter|use|apply|type|add)\s+(?:(?:the\s+)?(?:code|coupon|promo\s+code)\s+)?["'“]?([A-Za-z0-9][A-Za-z0-9_-]{2,})["'”]?\s+(?:at|in|during)\s+(?:the\s+)?checkout\b/gi
/** Words after "code" that name no code. */
const notACode =
  /^(?:at|in|on|for|to|the|and|or|below|above|here|when|is|it|this|that|yours?|now|today|was|will|you|code|coupon|voucher)$/i
/** A code-looking token: 6+ capitals and digits with both, not part of a word. */
const codeLike = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}\b(?!-)/g

/**
 * Words an email with these rules may say about money (rules 6 and 7):
 * - a percent next to a discount word ("15% off", "save 15 percent",
 *   "twenty percent off") only when it is the email's own offer within
 *   the max; a percent that is no discount ("100% organic") is fine;
 * - a money amount only when it is one of the store's (`amounts`); never
 *   money off, sale wording (was/now, now only, prices from), half price,
 *   buy N get M, N for $X, spend X get Y, or a gift card's worth;
 * - free shipping, a free gift and the like only inside an approved claim;
 * - a code ("use code X", "enter X at checkout", a code-looking token)
 *   only when it is the email's own (any case).
 */
export function wordsAllowed(words: string, rules: WordRules): boolean {
  let rest = words
  for (const claim of rules.claims ?? []) {
    const c = claim.trim()
    if (!c) continue
    rest = rest.replace(
      new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      ' '
    )
  }
  const offer = rules.offer
  const offerOk =
    !!offer &&
    Number.isInteger(offer.percent) &&
    offer.percent >= 1 &&
    offer.percent <= rules.maxDiscountPercent
  const discountAt = (index: number, length: number) =>
    discountBefore.test(rest.slice(Math.max(0, index - 14), index)) ||
    discountAfter.test(rest.slice(index + length, index + length + 14))
  for (const m of rest.matchAll(percentDigits))
    if (
      discountAt(m.index, m[0].length) &&
      (!offerOk || Number(m[1]!.replace(',', '.')) !== offer!.percent)
    )
      return false
  for (const m of rest.matchAll(percentSpelled))
    if (
      discountAt(m.index, m[0].length) &&
      (!offerOk || spelledValue(m[1]!) !== offer!.percent)
    )
      return false
  if (
    moneyOff.test(rest) ||
    saleWords.test(rest) ||
    otherOffers.test(rest) ||
    freeThings.test(rest) ||
    stockClaims.test(rest)
  )
    return false
  const allowed = new Set(
    (rules.amounts ?? []).flatMap((a) => moneyValue(a) ?? [])
  )
  for (const m of rest.matchAll(moneyDigits)) {
    const v = moneyValue(m[0])
    if (!v || !allowed.has(v)) return false
  }
  for (const m of rest.matchAll(moneySpelled)) {
    const v = String(spelledValue(m[0].replace(new RegExp(currency, 'i'), '')))
    if (!allowed.has(v)) return false
  }
  const ownCode = offerOk ? offer!.code.toUpperCase() : null
  for (const pattern of [namedCode, atCheckout])
    for (const m of rest.matchAll(pattern)) {
      const code = m[1] ?? m[2]!
      if (notACode.test(code)) continue
      if (code.toUpperCase() !== ownCode) return false
    }
  for (const m of rest.matchAll(codeLike))
    if (m[0].toUpperCase() !== ownCode) return false
  return true
}

/**
 * Words that carry a fact or a condition: a number, a percent, money, or
 * a phrase that limits a promise (over $50, until Sunday, only on, while
 * stocks last, first order, for new customers, selected, excludes, ends,
 * free shipping, a code…). Cutting such words, or dropping a sentence
 * holding them, could change what the email promises ("Free shipping on
 * orders over $50" → "Free shipping"), so they are used whole or not at
 * all. Plain words ("Free from additives", "Only the best leaves", "Off
 * to a great start") are not conditions.
 */
const conditions = new RegExp(
  [
    String.raw`\d|%|[$€£¥₹]`,
    String.raw`\b(?:over|under|above|below)\s+(?:[$€£¥₹]|\d|${spelled}\s+${currency}\b)`,
    String.raw`\b(?:until|till|through|thru)\b`,
    String.raw`\bonly\s+(?:on|for|with|until|when|while|today|tonight|this|at|in|online|available)\b`,
    String.raw`\bwhen\s+you\b`,
    String.raw`\bwhile\s+(?:stocks?|supplies|they)\s+last`,
    String.raw`\b(?:minimum|min\.?\s+(?:order|spend|purchase))\b`,
    String.raw`\bfirst\s+(?:order|purchase|box)\b`,
    String.raw`\b(?:for|to)\s+new\s+(?:customers?|subscribers?|members?)\b|\bnew\s+customers?\s+only\b`,
    String.raw`\bselected\b|\bselect\s+(?:items|styles|products|lines)\b`,
    String.raw`\bexclud(?:e|es|ed|ing)\b|\bexclusions?\b|\bexcept\b`,
    String.raw`\bnot\s+(?:on|for|in|available|valid|included|combinable|applicable)\b|\b(?:does|do)(?:\s+not|n['’]t)\s+apply\b|\bmembers?(?:\s+only)?\b|\bsubscribers?\s+only\b`,
    String.raw`\b(?:ends?|ending|expires?|expiring|valid|limited\s+(?:time|edition|stock|offer))\b`,
    String.raw`\b(?:terms|conditions)\s+apply\b|\bt\s?&\s?cs?\b`,
    String.raw`\bfree\s+(?:shipping|delivery|postage|returns?|gifts?|samples?)\b`,
    String.raw`\b(?:code|coupon|voucher|promo\s+code|discount)\b`
  ].join('|'),
  'i'
)
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
