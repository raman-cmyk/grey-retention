import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import { GMAIL_CLIP_BYTES } from '@/features/blocks/render'
import type { MessageBody } from '@/lib/providers/klaviyo/history'

/**
 * PIC-23 part 2a (owner pick #23, the founder's voice): what the store sent,
 * as a short excerpt of the owner's own words, safe to keep and to give an
 * AI. From Klaviyo's template (`readMessageBodies`): its plain-text part
 * (when it says enough), else its HTML read as a tree (never by pattern),
 * without what a reader never sees (hidden elements, the preview line's
 * padding), the footer (how to leave, why it was sent, the address) and
 * Klaviyo's tags. What the owner typed about other people goes:
 * - a review is dropped whole: its quote, its stars and the name under it,
 *   and any quoted block;
 * - email addresses, links (with or without https), social handles, phone
 *   numbers, postal addresses and long numbers become a placeholder;
 * - a tag that names a person's detail is kept as a placeholder ("Hi
 *   [first name],"), since how an owner greets is voice.
 * Names the owner typed in their own sentences are not found by code: only
 * these shapes are (the ledger's known issues).
 *
 * A letter from Klaviyo's rich text editor is the owner's voice most of
 * all; a designed promotion is mostly headlines and buttons, so it counts
 * for less (`weight`). Every pattern here is bounded, and the HTML read is
 * cut where Gmail cuts an email, so a tenant's template never stalls the
 * worker.
 */
export type VoiceExcerpt = {
  messageId: string
  text: string
  /** How much it says about the voice: 3 a letter, 2 code, 1 designed. */
  weight: 1 | 2 | 3
  /** The owner's words in it (placeholders not counted). */
  words: number
}

/** The most characters one excerpt keeps. */
export const maxExcerptChars = 8_000
/** The fewest words of the owner's that say anything about a voice. */
export const minExcerptWords = 25

const weights: Record<MessageBody['editor'], VoiceExcerpt['weight']> = {
  rich_text: 3,
  code: 2,
  hybrid: 1,
  drag_and_drop: 1,
  unknown: 1
}

// ---------------------------------------------------------------- the HTML

const skipped = new Set([
  'script',
  'style',
  'head',
  'title',
  'template',
  'noscript',
  'svg',
  'math',
  'blockquote'
])
const blocks = new Set([
  'p',
  'div',
  'table',
  'tr',
  'td',
  'th',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'section',
  'article',
  'header',
  'footer',
  'ul',
  'ol',
  'center'
])
const isElement = (n: T.Node): n is T.Element => 'tagName' in n
const attr = (e: T.Element, name: string) =>
  e.attrs.find((a) => a.name === name)?.value ?? ''

/** An element a reader never sees: hidden by its style or its class. */
function hidden(e: T.Element) {
  const style = attr(e, 'style').toLowerCase().replace(/\s+/g, '')
  if (
    /display:none|visibility:hidden|mso-hide:all/.test(style) ||
    (/max-height:0/.test(style) && /overflow:hidden/.test(style)) ||
    /(?:^|;)font-size:0(?:px)?(?:;|!|$)/.test(style)
  )
    return true
  if (e.attrs.some((a) => a.name === 'hidden')) return true
  return /\b(?:preheader|preview-?text|hidden)\b/i.test(attr(e, 'class'))
}

/** The most tags of a template read (a real email has far fewer). */
const maxTags = 6_000

/** The HTML's visible words, a line per block (never a pattern on HTML). */
function visibleLines(html: string) {
  // Gmail shows no more: a longer template is cut, never parsed whole; and
  // at most `maxTags` tags (deep nesting is slow to parse).
  let head = html.slice(0, GMAIL_CLIP_BYTES)
  for (let i = 0, n = 0; i < head.length; i++)
    if (head.charCodeAt(i) === 60 && ++n > maxTags) {
      head = head.slice(0, i)
      break
    }
  const document = parse(head)
  let out = ''
  const stack: (T.Node | string)[] = [document]
  let steps = 0
  while (stack.length && steps++ < 200_000) {
    const node = stack.pop()!
    if (typeof node === 'string') {
      out += node
      continue
    }
    if (node.nodeName === '#text') {
      out += (node as T.TextNode).value.replace(/\s+/g, ' ')
      continue
    }
    if (isElement(node)) {
      if (skipped.has(node.tagName) || hidden(node)) continue
      if (node.tagName === 'br') {
        out += '\n'
        continue
      }
      if (blocks.has(node.tagName)) {
        out += '\n'
        stack.push('\n')
      }
    }
    const children =
      'childNodes' in node ? (node as T.ParentNode).childNodes : []
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!)
  }
  return out
}

// ---------------------------------------------------------------- the text

/** Characters a reader never sees (the preview line's padding among them). */
const invisible = /[­͏؜᠎​-‏⁠-⁤﻿]/g

/** A tag naming a person's detail, as a placeholder. */
function placeholder(tag: string) {
  const name = tag.toLowerCase()
  if (/first_?name/.test(name)) return '[first name]'
  if (/last_?name/.test(name)) return '[last name]'
  if (/organization\.name/.test(name)) return '[store name]'
  return '[detail]'
}

/** A footer line, read before Klaviyo's tags go (they mark one). */
const footerTag =
  /\{%-?\s*(?:unsubscribe|manage_preferences|web_view)|\{\{\s*organization\.(?:full_address|url)/i
const footerWords =
  /\bunsubscribe\b|\bmanage (?:your )?preferences\b|\bupdate (?:your )?preferences\b|\bview (?:it |this email )?in (?:your |a )?browser\b|\btrouble viewing\b|\byou(?:['’]re| are)? (?:receiving|getting|get) (?:this|these)\b|\bno longer (?:want|wish)\b|\ball rights reserved\b|\bsent to \[email\]/i

/** A line of a review: its stars, its quote, the name under it. */
const stars = /[★☆⭐]|\b[1-5](?:\.\d)? ?(?:stars?|\/ ?5|out of 5)\b/i
const startsQuoted = /^(?:[★☆⭐\s]*)["“”«„'‘]/
const attribution =
  /^(?:[—–-]|~)\s*\S|^\s*verified (?:buyer|customer|purchase)\b/i
/** A short line of capitalised words: a name under a review. */
const nameLike = (line: string) =>
  line.length <= 40 &&
  /^[\p{Lu}][\p{L}.'’-]*(?:\s+[\p{Lu}][\p{L}.'’-]*){0,3}(?:,.*)?$/u.test(line)

/** How much of a line is inside double quotes (an inch mark is not). */
function quotedShare(line: string) {
  const spans = line.match(/["“„«][^"“”„«»\n]{1,300}["”»]/g) ?? []
  const inside = spans.reduce((n, s) => n + s.length, 0)
  return line.length ? inside / line.length : 0
}

const email = /[a-z0-9._%+'-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,8}/gi
const link =
  /\b(?:https?:\/\/[^\s<>"')]{1,500}|www\.[^\s<>"')]{1,500}|(?:[a-z0-9-]{1,63}\.){1,8}(?:com|net|org|co|io|shop|store|uk|us|ca|au|de|fr|nl|eu|example|app|me|info|biz)\b(?:\/[^\s<>"')]{0,300})?)/gi
const handle = /(?<![\p{L}\p{N}.])@[a-z0-9._]{2,30}\b/giu
const street =
  /\b\d{1,5}\s+(?:[\p{L}'-]+\s+){1,4}(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|way|court|ct|terrace|place|pl|close|crescent|square|sq|highway|hwy)\b\.?/giu
const postcode =
  /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b|\b[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}\b/g
const longNumber = /\d{6,}/g
/** A phone number: seven or more digits, a group of three, never a date. */
function phones(text: string) {
  return text.replace(
    /(?<![\p{L}\p{N}])\+?\(?\d[\d\s().-]{5,20}\d\)?(?![\p{L}\p{N}])/gu,
    (found) => {
      const digits = found.replace(/\D/g, '')
      const date = /^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/
      const grouped = /\d{3}/.test(found)
      return digits.length >= 7 && grouped && !date.test(found.trim())
        ? '[phone]'
        : found
    }
  )
}

/** The owner's words in a text: a placeholder is not one. */
const count = (text: string) =>
  text
    .replace(/\[[a-z ]{2,20}\]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/**
 * The text between each `open` and the next `close`, out, in one pass (a
 * block never closed: the rest of the text). With `keepClose`, the close
 * stays (an `endif` after an `else`).
 */
function dropBetween(
  text: string,
  open: RegExp,
  close: RegExp,
  keepClose = false
) {
  let out = ''
  let i = 0
  for (;;) {
    open.lastIndex = i
    const o = open.exec(text)
    if (!o) break
    out += text.slice(i, o.index) + ' '
    close.lastIndex = o.index + o[0].length
    const c = close.exec(text)
    if (!c) return out
    i = keepClose ? c.index : c.index + c[0].length
  }
  return out + text.slice(i)
}

/** Klaviyo's comments and the other branch of a choice, out of the whole text. */
const unblock = (text: string) =>
  dropBetween(
    dropBetween(
      text,
      /\{%-?\s*comment\s*-?%\}/gi,
      /\{%-?\s*endcomment\s*-?%\}/gi
    ),
    /\{%-?\s*else\s*-?%\}/gi,
    /\{%-?\s*endif\s*-?%\}/gi,
    true
  )

/** Klaviyo's tags in a line: a person's detail as a placeholder, logic out. */
const unlogic = (text: string) =>
  text
    .replace(/\{\{([^{}]{0,500})\}\}/g, (_, tag: string) => placeholder(tag))
    .replace(/\{%[^{}]{0,500}%\}/g, ' ')
    // What is left of a tag that never closed.
    .replace(/\{\{|\}\}|\{%|%\}/g, ' ')

/** The owner's lines of a text, reviews and the footer out. */
function ownLines(source: string) {
  const kept: string[] = []
  let review = false
  for (const raw of source.replace(invisible, '').split('\n')) {
    const tagged = raw
      .replace(/ /g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim()
    if (!tagged) {
      kept.push('')
      continue
    }
    if (footerTag.test(tagged)) continue
    const line = unlogic(tagged)
      .replace(/[ \t]+/g, ' ')
      .trim()
    if (!line) continue
    if (footerWords.test(line)) continue
    // A review, whole: its stars, its quote and who wrote it.
    const quote = startsQuoted.test(line) || quotedShare(line) > 0.5
    if (stars.test(line) || quote) {
      review = true
      continue
    }
    if (attribution.test(line) || (review && nameLike(line))) continue
    review = false
    kept.push(line)
  }
  return kept.join('\n')
}

const redact = (text: string) =>
  phones(
    text
      .replace(email, '[email]')
      .replace(link, '[link]')
      .replace(handle, '[handle]')
      .replace(street, '[address]')
      .replace(postcode, '[address]')
  ).replace(longNumber, '[number]')

/** Cut at `max` on a word, never inside a character written as two units. */
function cut(text: string, max: number) {
  if (text.length <= max) return text
  const head = text.slice(0, max + 1)
  const at = head.search(/\s\S*$/)
  return (at > 0 ? head.slice(0, at) : text.slice(0, max))
    .replace(/[\uD800-\uDBFF]$/, '')
    .trimEnd()
}

function excerptOf(source: string) {
  return (
    redact(ownLines(unblock(source)))
      .split('\n')
      .map((line) => line.trim())
      // A line with an address is about the address, never voice; a line
      // with none of the owner's words (only placeholders) says nothing.
      .filter(
        (line) => !line || (!line.includes('[address]') && count(line) > 0)
      )
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/** One email's words as a voice excerpt, or null when it says too little. */
export function voiceExcerpt(body: MessageBody): VoiceExcerpt | null {
  // The plain-text part when it says enough, else the HTML.
  const fromText = body.text?.trim()
    ? excerptOf(body.text.slice(0, GMAIL_CLIP_BYTES))
    : ''
  const text =
    count(fromText) >= minExcerptWords
      ? fromText
      : excerptOf(visibleLines(body.html))
  const kept = cut(text, maxExcerptChars)
  const words = count(kept)
  if (words < minExcerptWords) return null
  return {
    messageId: body.messageId,
    text: kept,
    weight: weights[body.editor],
    words
  }
}
