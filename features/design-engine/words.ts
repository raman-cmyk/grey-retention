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

/** Words an email with these rules may say. */
export function wordsAllowed(words: string, rules: WordRules): boolean {
  for (const m of words.matchAll(percents)) {
    const n = Number(m[1]!.replace(',', '.'))
    if (!rules.offer || n !== rules.offer.percent) return false
    if (n > rules.maxDiscountPercent) return false
  }
  for (const m of words.matchAll(codeLike))
    if (m[0] !== rules.offer?.code && /\d/.test(m[0])) return false
  return true
}

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

/**
 * Hands out the brand's words slot by slot. The same pools and slots
 * always give the same words; a text is used once while unused ones are
 * left, then again from the start.
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
    const all = candidates(role)
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
    let out = best
    // A long paragraph slot takes more of the brand's sentences.
    if (role === 'body' || role === 'caption')
      for (const w of [...from, ...all]) {
        if (out.length >= chars * 0.9) break
        if (out.includes(w)) continue
        used.add(w)
        out = `${out} ${w}`
      }
    return cutTo(out, Math.max(4, Math.round(chars * 1.05)))
  }
  /**
   * More of the role's words after `text`, for a slot `chars` long whose
   * words broke onto fewer lines than the original's: whole texts of the
   * role not in it yet, or null when there are none.
   */
  const more: Lengthen = (role, text, chars) => {
    let out = text
    for (const w of candidates(role)) {
      if (out.length >= chars) break
      if (out.includes(w)) continue
      used.add(w)
      out = `${out} ${w}`
    }
    if (out === text) return null
    return cutTo(out, Math.max(4, Math.round(chars * 1.05)))
  }
  return { pick, more }
}

/** More words for a slot of `role`, `chars` long, after `text` (or null). */
export type Lengthen = (
  role: PartRole,
  text: string,
  chars: number
) => string | null
