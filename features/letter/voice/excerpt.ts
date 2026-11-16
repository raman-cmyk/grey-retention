import { htmlToText } from '@/features/email-generation/html'
import type { MessageBody } from '@/lib/providers/klaviyo/history'

/**
 * PIC-23 part 2a (owner pick #23, the founder's voice): what the store sent,
 * as a short excerpt of the owner's own words, safe to keep and to give an
 * AI. From Klaviyo's template (`readMessageBodies`): its plain-text part,
 * else its HTML as text, without the hidden preview line, the footer
 * (unsubscribe, preferences, the address) and Klaviyo's tags. What the
 * owner typed about other people goes: a line that quotes someone (a
 * review, a testimonial, with its name) is a customer's words, never the
 * owner's voice; addresses, phone numbers, links and long numbers become
 * a placeholder. A template tag that names a person's detail is kept as a
 * placeholder ("Hi [first name],"), since how an owner greets is voice.
 *
 * A letter written in Klaviyo's rich text editor is the owner's voice most
 * of all; a designed promotion is mostly headlines and buttons, so it
 * counts for less (`weight`).
 */
export type VoiceExcerpt = {
  messageId: string
  text: string
  /** How much it says about the voice: 3 a letter, 2 code, 1 designed. */
  weight: 1 | 2 | 3
  words: number
}

/** The most characters one excerpt keeps. */
export const maxExcerptChars = 8_000
/** The fewest words that say anything about a voice. */
export const minExcerptWords = 25

const weights: Record<MessageBody['editor'], VoiceExcerpt['weight']> = {
  rich_text: 3,
  code: 2,
  hybrid: 1,
  drag_and_drop: 1,
  unknown: 1
}

/** Elements a reader never sees: the hidden preview line, mostly. */
const hidden =
  /<(div|span|p|td)\b[^>]*style\s*=\s*["'][^"']*(?:display\s*:\s*none|mso-hide\s*:\s*all)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi

/** A tag naming a person's detail, as a placeholder. */
function placeholder(tag: string) {
  const name = tag.toLowerCase()
  if (/first_?name/.test(name)) return '[first name]'
  if (/last_?name/.test(name)) return '[last name]'
  if (/organization\.name/.test(name)) return '[store name]'
  return '[detail]'
}

const email = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi
const link = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi
const phone = /(?<![\p{L}\p{N}])\+?\d[\d\s().-]{7,}\d(?![\p{L}\p{N}])/gu
const longNumber = /\d{6,}/g
/** A line that quotes someone: a customer's words, never the owner's. */
const quoted = /["“”«»]|(?:^|\s)['‘’][^'‘’]{12,}['‘’](?:\s|$)/
/** A footer line: how to leave, where the store is, why it was sent. */
const footer =
  /\bunsubscribe\b|\bmanage (?:your )?preferences\b|\bview (?:it )?in (?:your )?browser\b|\byou(?:['’]re| are) receiving this\b|\bno longer (?:want|wish) to receive\b|\ball rights reserved\b/i

const count = (text: string) =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/** One email's words as a voice excerpt, or null when it says too little. */
export function voiceExcerpt(body: MessageBody): VoiceExcerpt | null {
  const source = body.text?.trim() || htmlToText(body.html.replace(hidden, ' '))
  const text = source
    // Klaviyo's tags: a person's detail as a placeholder; logic dropped.
    .replace(/\{\{([\s\S]*?)\}\}/g, (_, tag: string) => placeholder(tag))
    .replace(/\{%[\s\S]*?%\}/g, ' ')
    .replace(email, '[email]')
    .replace(link, '[link]')
    .replace(phone, '[phone]')
    .replace(longNumber, '[number]')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => !quoted.test(line) && !footer.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const words = count(text)
  if (words < minExcerptWords) return null
  const cut =
    text.length > maxExcerptChars
      ? text.slice(0, maxExcerptChars).replace(/\s+\S*$/, '')
      : text
  return {
    messageId: body.messageId,
    text: cut,
    weight: weights[body.editor],
    words: count(cut)
  }
}
