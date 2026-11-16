import { z } from 'zod'

/**
 * TXT-001 (D26, AGENT_MAP §4 "Text emails"): a text email is a short
 * personal letter, its own format beside the designed email. One idea in
 * 80 to 250 words, a sign-off with a name, an optional P.S., and one or
 * two links inside the sentences. The writer never writes an address: it
 * marks the words of a link as `[the words](1)`, and code puts in the
 * store's link number 1 (the links come from the locked content, never
 * from the writer).
 */
export const letterWords = { min: 80, max: 250 } as const
/** The most links a letter shows (each link written in the text counts). */
export const maxLetterLinks = 2

const line = (max: number) => z.string().trim().min(1).max(max)

export const letterSchema = z.object({
  subject: line(120),
  preheader: z.string().trim().max(200),
  /** "Hi there," (optional). */
  greeting: line(80).optional(),
  /** The letter, a paragraph each; links as `[the words](1)`. */
  body: z.array(line(1500)).min(1).max(8),
  /** "Warmly," */
  signoff: line(60),
  /** The name that signs, e.g. "Maya". */
  signature: line(80),
  /** Who that is, e.g. "Founder, Cedar Lane" (optional). */
  role: line(80).optional(),
  /** The P.S., without its "P.S." (optional). */
  ps: line(400).optional(),
  /**
   * The locked offer, placed by code after the letter as its own line (the
   * writer never writes a code or its end).
   */
  offer: z
    .object({
      code: line(40),
      percent: z.int().min(1).max(100),
      /** "Ends November 22 at 11:59 PM PST" (optional). */
      ends: line(80).optional()
    })
    .optional(),
  /** The store's links the text may point to, numbered from 1 (code's). */
  links: z.array(z.object({ url: z.string().trim().min(1).max(2000) })).max(4)
})
export type Letter = z.infer<typeof letterSchema>

/** The offer's own line: "Use the code CANDLE10 for 10% off. Ends …". */
export const offerLine = (offer: NonNullable<Letter['offer']>) =>
  `Use the code ${offer.code} for ${offer.percent}% off.${offer.ends ? ` ${offer.ends.replace(/\.?$/, '.')}` : ''}`

/**
 * A link in the text: `[the words](n)`. Its words are on one line, at
 * most 120 characters, with no bracket or backslash; anything else that
 * looks like a mark is refused by the checks (`brokenMark`). Use it only
 * with `matchAll` and `replace` (it is global).
 */
export const linkMark = /\[([^[\]\n\\]{1,120})\]\((\d{1,2})\)/g

/** What is left of a mark once the real ones are taken out: refused. */
export const brokenMark = /\]\(|\]\s+\(\d{1,2}\)/

/** Link words a reader can see: a letter or a digit. */
export const visibleWords = (words: string) => /[\p{L}\p{N}]/u.test(words)

export type LinkUse = { words: string; n: number }

/** The links a piece of text writes, in order. */
export function linksIn(text: string): LinkUse[] {
  return [...text.matchAll(linkMark)].map((m) => ({
    words: m[1]!.trim(),
    n: Number(m[2])
  }))
}

/** Text as the reader sees it: a link's words, not its mark. */
export const seenText = (text: string) =>
  text.replace(linkMark, (_, words: string) => words)

/** "P.S.", "P. S.", "P.P.S.", "PS:" or "PPS:" the writer typed before its P.S. */
export const psMark = /^(?:(?:p\.\s*)?p\.\s*s\b\.?:?|p{1,2}s\s*:)\s*/i

/** The parts of the letter the writer wrote that a reader reads as the letter: the only parts with links. */
export const letterText = (letter: Letter) => [
  ...letter.body,
  ...(letter.ps ? [letter.ps.replace(psMark, '')] : [])
]

/** Words, as a reader counts them: a run with a letter or a digit in it. */
export function wordCount(text: string) {
  return seenText(text)
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}
