import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import { GMAIL_CLIP_BYTES } from '@/features/blocks/render'
import {
  holidayCountries,
  platformHolidays
} from '@/features/holidays/platform'
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
  'math'
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
  // (Never `font-size:0` alone: MJML sets it on every column, and the
  // words inside set their own size.)
  if (
    /display:none|visibility:hidden|mso-hide:all/.test(style) ||
    (/max-height:0/.test(style) && /overflow:hidden/.test(style))
  )
    return true
  if (e.attrs.some((a) => a.name === 'hidden')) return true
  return attr(e, 'class')
    .toLowerCase()
    .split(/\s+/)
    .some((c) =>
      ['preheader', 'preview-text', 'previewtext', 'hidden'].includes(c)
    )
}

/** A line that marks a review the HTML held (a quote block, star pictures). */
export const reviewMark = '@@review@@'
const quoteBlocks = new Set(['blockquote', 'cite', 'figcaption', 'q'])
const reviewWords =
  /\b(?:\d(?:\.\d)?|one|two|three|four|five)[\s-]*stars?\b|\bstars?[\s-]*rating\b|\brating\b|\breviews?\b|\btestimonials?\b/i
/** A star's picture by its file: star.png, 5-stars.png, star-full.svg. */
const starFile =
  /(?:^|\/)(?:\d[-_]?)?stars?(?:[-_](?:full|filled|empty|half|on|off|rating|icon|gold|yellow|\d))?\.(?:png|gif|jpe?g|svg|webp)(?:$|[?#])/i
const starPicture = (e: T.Element) =>
  (e.tagName === 'img' &&
    (reviewWords.test(`${attr(e, 'alt')} ${attr(e, 'src')}`) ||
      starFile.test(attr(e, 'src')))) ||
  attr(e, 'class')
    .toLowerCase()
    .split(/\s+/)
    .some((c) =>
      /(?:^|[-_])(?:reviews?|testimonials?|rating)(?:$|[-_])/.test(c)
    )
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
      // A quote block or a star picture: a review, marked for the text.
      if (quoteBlocks.has(node.tagName) || starPicture(node)) {
        out += `\n${reviewMark}\n`
        continue
      }
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

/** Code points a reader never sees (a preview line's padding among them). */
const invisibleRanges: [number, number][] = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0x2800, 0x2800],
  [0x3164, 0x3164],
  [0xfeff, 0xfeff]
]
const nbsp = String.fromCharCode(0xa0)
const visible = (text: string) =>
  Array.from(text)
    .filter((ch) => {
      const c = ch.codePointAt(0)!
      return !invisibleRanges.some(([from, to]) => c >= from && c <= to)
    })
    .join('')
    .split(nbsp)
    .join(' ')

/** A tag naming a person's detail, as a placeholder. */
function placeholder(tag: string) {
  const name = tag.toLowerCase()
  if (/first_?name/.test(name)) return '[first name]'
  if (/last_?name/.test(name)) return '[last name]'
  if (/organization\.name/.test(name)) return '[store name]'
  return '[detail]'
}

/** A footer's own tags: the address, the store's link, how to leave. */
const footerMark = '@@footer@@'
const footerTag =
  /\{%-?\s*(?:unsubscribe|manage_preferences|web_view)|\{\{\s*organization\.(?:full_address|url)/i
const footerWords =
  /\bunsubscribe\b|\bmanage (?:your )?preferences\b|\bupdate (?:your )?preferences\b|\bview (?:it |this email )?in (?:your |a )?browser\b|\btrouble viewing\b|\byou(?:['’]re| are)? (?:receiving|getting|get) (?:this|these)\b|\bno longer (?:want|wish)\b|\ball rights reserved\b|\bthis email was sent to\b/i

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

/**
 * Klaviyo's tags, over the whole text: comments and every branch of a
 * choice but the first out; a footer's tags marked; a person's detail as a
 * placeholder (a tag over two lines too); logic out.
 */
function untag(text: string) {
  const branches = dropBetween(
    dropBetween(
      text,
      /\{%-?\s*comment\s*-?%\}/gi,
      /\{%-?\s*endcomment\s*-?%\}/gi
    ),
    /\{%-?\s*(?:elif|else)\b[^{}]{0,300}%\}/gi,
    /\{%-?\s*endif\s*-?%\}/gi,
    true
  )
  const loops = dropBetween(
    branches,
    /\{%-?\s*empty\s*-?%\}/gi,
    /\{%-?\s*endfor\s*-?%\}/gi,
    true
  )
  return (
    loops
      .split('\n')
      .map((line) => (footerTag.test(line) ? footerMark : line))
      .join('\n')
      .replace(/\{\{([^{}]{0,500})\}\}/g, (_, tag: string) => placeholder(tag))
      .replace(/\{%[^{}]{0,500}%\}/g, ' ')
      // What is left of a tag that never closed.
      .replace(/\{\{|\}\}|\{%|%\}/g, ' ')
  )
}

// ---------------------------------------------------------------- reviews

/** Stars: a run of them, a line that is mostly stars, or a rating first. */
const starGlyphs = /[★☆⭐]/gu
const starRun = /[★☆⭐]{3,}/u
const ratingFirst =
  /^\s*(?:[1-5](?:\.\d)?\s?(?:stars?|\/\s?5|out of 5)\b|star rating\b)/i
function starLine(line: string) {
  if (starRun.test(line) || ratingFirst.test(line)) return true
  const glyphs = line.match(starGlyphs)?.length ?? 0
  return glyphs > 0 && glyphs * 2 >= line.replace(/\s+/g, '').length
}
/** A quotation: double quotes or guillemets (an apostrophe is not one). */
const startsQuoted = /^["“”«„]/
const reviewLine =
  /\bverified (?:buyer|customer|purchase|review(?:er)?)\b|^\s*(?:customer |our )?reviews?\s*(?:by\b|:)|^\s*reviewed by\b/i
/** How much of a line is inside double quotes (an inch mark is not). */
function quotedShare(line: string) {
  const spans = line.match(/["“„«][^"“”„«»\n]{1,300}["”»]/g) ?? []
  const inside = spans.reduce((n, s) => n + s.length, 0)
  return line.length ? inside / line.length : 0
}
const wordsIn = (line: string) => line.split(/\s+/).filter(Boolean).length

/** The text's lines, each review out with its stars, its quote and its name. */
function withoutReviews(lines: readonly string[], own: OwnWords) {
  const kept: string[] = []
  let after = false
  for (const line of lines) {
    if (!line) {
      kept.push('')
      continue
    }
    // "— Jordan Sample": a name signed under a quote, dropped on its own.
    const dashName = /^\s*[—–~-]\s*(.+)$/.exec(line)
    if (
      dashName &&
      wordsIn(dashName[1]!) <= 5 &&
      hasName(dashName[1]!, own) &&
      after
    ) {
      after = false
      continue
    }
    const review =
      line === reviewMark ||
      starLine(line) ||
      (startsQuoted.test(line) && quotedShare(line) > 0.5) ||
      reviewLine.test(line)
    if (review) {
      // A name kept just above a review was its writer.
      let at = kept.length - 1
      while (at >= 0 && !kept[at]) at--
      if (at >= 0 && wordsIn(kept[at]!) <= 5 && hasName(kept[at]!, own))
        kept.splice(at, 1)
      after = true
      continue
    }
    // The one line after a review: its name, or its few words.
    if (after && (wordsIn(line) <= 8 || hasName(line, own))) {
      after = false
      continue
    }
    after = false
    kept.push(line)
  }
  return kept
}

// ---------------------------------------------------------------- redaction

const email = /[a-z0-9._%+'-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,8}/gi
const link =
  /\b(?:https?:\/\/[^\s<>"')]{1,500}|www\.[^\s<>"')]{1,500}|(?:[a-z0-9-]{1,63}\.){1,8}(?:com|net|org|co|io|shop|store|uk|us|ca|au|de|fr|nl|eu|example|app|me|info|biz)\b(?:\/[^\s<>"')]{0,300})?)/gi
const handle = /(?<![\p{L}\p{N}.])@[a-z0-9._]{2,30}\b/giu
/** A street address: a number, a capitalised street name, its kind. */
const addresses = [
  /\b\d{1,5}\s+(?:[\p{Lu}][\p{L}'-]*\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Way|Court|Ct|Terrace|Place|Pl|Close|Crescent|Square|Sq|Highway|Hwy)\b/u,
  /\b\d{1,5},?\s+(?:rue|avenue|boulevard|chemin|place|allée|calle|via|piazza)\s+[\p{Lu}]/iu,
  /\b[\p{Lu}][\p{L}-]*(?:straße|strasse|weg|gasse|platz|laan|straat|gatan)\s+\d{1,4}\b/u,
  /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/,
  /\b[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}\b/,
  /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/,
  /,\s*\d{4,5}\s+[\p{Lu}][\p{L}-]+/u
]
const longNumber = /\d{6,}/g
/** A phone number: seven or more digits, a group of three, never a date. */
function phones(text: string) {
  return text.replace(
    /(?<![\p{L}\p{N}])\+?\(?\d[\d\s().-]{5,20}\d\)?(?![\p{L}\p{N}])/gu,
    (found) => {
      const digits = found.replace(/\D/g, '')
      const date = /^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/
      return digits.length >= 7 &&
        /\d{3}/.test(found) &&
        !date.test(found.trim())
        ? '[phone]'
        : found
    }
  )
}

// ---------------------------------------------------------------- names

/**
 * One spelling for the store's words and a line's: NFKC, lower case, one
 * apostrophe, no punctuation at a word's ends ("Co." is "co").
 */
const normWord = (word: string) =>
  trimEnds(word.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'"), (c) =>
    /[\p{L}\p{N}]/u.test(c)
  )

/**
 * A word without the characters at its ends that `keep` refuses, by a
 * loop from each end (a pattern anchored at the end tries every start:
 * slow on a long run of commas).
 */
function trimEnds(word: string, keep: (char: string) => boolean) {
  const chars = Array.from(word)
  let from = 0
  let to = chars.length
  while (from < to && !keep(chars[from]!)) from++
  while (to > from && !keep(chars[to - 1]!)) to--
  return chars.slice(from, to).join('')
}

/** The store's own words, by their runs of one to three words (`ownWordsOf`). */
export type OwnWords = { readonly runs: ReadonlySet<string> }
const maxOwnPhrases = 50_000
const maxOwnWordsEach = 12
const maxOwnRuns = 200_000

/**
 * The store's own words (its name, its product titles) as the name check
 * reads them. Build it once and pass it to every `voiceExcerpt` of a run:
 * at most 50,000 phrases, 12 words each, 200,000 runs in all.
 */
export function ownWordsOf(own: readonly string[]): OwnWords {
  const runs = new Set<string>()
  addRuns(runs, own.slice(0, maxOwnPhrases), maxOwnRuns)
  return { runs }
}

function addRuns(runs: Set<string>, phrases: readonly unknown[], max: number) {
  for (const phrase of phrases) {
    if (typeof phrase !== 'string') continue
    const words = phrase
      .split(/\s+/)
      .slice(0, maxOwnWordsEach)
      .map((w) => (w.length > maxTokenChars ? '' : normWord(w)))
      .filter(Boolean)
    for (let i = 0; i < words.length; i++)
      for (let n = 1; n <= 3 && i + n <= words.length; n++) {
        if (runs.size >= max) return
        runs.add(words.slice(i, i + n).join(' '))
      }
  }
}

/**
 * The occasions emails are sent for (the planner's holidays, every
 * country's, and the days stores sell on): no one's name, whatever the
 * store passes. Built once.
 */
const extraOccasions = [
  'Earth Day',
  'International Cat Day',
  'International Coffee Day',
  'International Day of Yoga',
  'International Dog Day',
  'International Tea Day',
  'International Women’s Day',
  'National Pet Day',
  'World Chocolate Day',
  'World Environment Day',
  'World Health Day',
  'World Mental Health Day',
  'Cinco de Mayo',
  'Mardi Gras',
  'Eid Mubarak',
  'Eid al-Fitr',
  'Eid al-Adha',
  'Ramadan Kareem',
  'Chinese New Year',
  'Rosh Hashanah',
  'Yom Kippur',
  'Prime Day',
  'Green Monday',
  'Small Business Saturday',
  'Singles Day',
  'Super Bowl Sunday',
  'Black History Month',
  'Pride Month',
  'Back To School',
  'Boxing Week',
  'Cyber Week',
  'Fourth Of July',
  'Bastille Day',
  'Burns Night',
  'Pancake Day',
  'Shrove Tuesday',
  'Ash Wednesday',
  'Palm Sunday',
  'Easter Sunday',
  'St. Andrew’s Day',
  'St. David’s Day',
  'St. George’s Day',
  'Guy Fawkes Night'
]
let occasions: ReadonlySet<string> | null = null
function occasionRuns(): ReadonlySet<string> {
  if (occasions) return occasions
  const names = holidayCountries.flatMap((c) =>
    platformHolidays({ country: c.code, from: '2026-01-01', days: 366 }).map(
      (h) => h.name.replace(/\s*\(.*\)\s*$/, '')
    )
  )
  const runs = new Set<string>()
  addRuns(runs, [...new Set([...names, ...extraOccasions])], 10_000)
  occasions = runs
  return runs
}
const ownHas = (own: OwnWords, run: string) =>
  own.runs.has(run) || occasionRuns().has(run)

/** Words of the calendar: they may start a name (April, Summer), never make one alone. */
const calendar = new Set(
  "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december black cyber small business christmas easter new year eve day mother's father's valentine's thanksgiving halloween boxing labor labour memorial independence spring summer autumn fall winter".split(
    ' '
  )
)
/**
 * Common words a heading, a greeting or a sentence's start is made of
 * (and the verbs an email's sentences start with): never part of a name,
 * so "Meet Jordan Sample" keeps "Meet" and loses the name, and "Happy
 * Thanksgiving" or "Our Story" stay.
 */
const common = new Set(
  'a an the this that these those next last first our your my his her their its all every each any some no not happy merry thank thanks dear hi hello hey welcome congrats congratulations good great best top big little new free pro fun quick early final special limited meet shop sale sold out coming soon sneak peek studio diary field notes gift gifts tip tips fact facts story stories news note update updates team love from with without and or but so if then when while after before also just only still yet please for of to in on at by into about over under up down off is are was were be been will can do does did have has had here there now today tonight tomorrow back thoughts morning evening night weekend week month year season holiday holidays edition collection deal deals offer offers order orders shipping stock open closed inside behind scenes look birthday anniversary winner winners customer customers member members spotlight shoutout photo photos giveaway take get try make keep find see join come bring give grab save enjoy discover explore read watch learn start let check pick choose wear treat send call visit tell ask go you yours us we i me it they he she who what why how where which one two three'.split(
    ' '
  )
)
const titleWords = new Set(['mr', 'mrs', 'ms', 'mx', 'dr', 'miss', 'prof'])
/** Common words that are also surnames: they end a name after its part. */
const surnameLike = new Set(
  'little best good field story read winner will love hope young king rose page'.split(
    ' '
  )
)
const particleWords = new Set(
  'de da di du la le van von der den del dos das al'.split(' ')
)
/** Abbreviations written like initials: never a name. */
const abbreviations = new Set(
  'p.s. p.p.s. n.b. u.s. u.s.a. u.k. e.u. a.m. p.m. d.c. l.a. n.y. n.y.c. u.a.e. e.g. i.e.'.split(
    ' '
  )
)
/** A capitalised word: McDonald, O'Brien, Mary-Kate, JORDAN, Иван. */
const capitalised = /^\p{Lu}[\p{L}'’-]{1,24}$/u
/** Initials: J., A.J., J.R.R. */
const initials = /^(?:\p{Lu}\.){1,3}$/u
const openingChars = new Set(Array.from('("“«‘\'['))
const closingChars = new Set(Array.from(',;:!?.)"”»’\']'))
/** A token longer than this is no word of a name (a part is at most 25 letters). */
const maxTokenChars = 40

type Kind =
  'part' | 'initial' | 'calendar' | 'title' | 'particle' | 'surname' | 'stop'
type Token = {
  kind: Kind
  /** Where its word starts and ends in the line (punctuation outside). */
  start: number
  end: number
  norm: string
  /** Punctuation before it: a name starts here. */
  opens: boolean
  /** Punctuation after it: a name ends here. */
  closes: boolean
  /** It starts with a capital letter. */
  upper: boolean
}

function tokensOf(line: string): Token[] {
  const out: Token[] = []
  for (const m of line.matchAll(/\S+/g)) {
    const raw = m[0]
    const at = m.index ?? 0
    if (raw.length > maxTokenChars) {
      out.push({
        kind: 'stop',
        start: at,
        end: at + raw.length,
        norm: '',
        opens: false,
        closes: true,
        upper: false
      })
      continue
    }
    let lead = 0
    while (lead < raw.length && openingChars.has(raw[lead]!)) lead++
    let cut = raw.length
    while (cut > lead && closingChars.has(raw[cut - 1]!)) cut--
    let word = raw.slice(lead, cut)
    let tail = raw.slice(cut)
    // An initial's own full stop is its own ("A.J.", "P.S.").
    if (tail.startsWith('.') && initials.test(`${word}.`)) {
      word += '.'
      tail = tail.slice(1)
    }
    const norm = normWord(word)
    let kind: Kind = 'stop'
    if (abbreviations.has(word.toLowerCase())) kind = 'stop'
    else if (initials.test(word)) kind = 'initial'
    else if (capitalised.test(word)) {
      if (titleWords.has(norm)) {
        kind = 'title'
        // "Mrs." : the title's full stop does not end the name.
        if (tail.startsWith('.')) tail = tail.slice(1)
      } else if (surnameLike.has(norm)) kind = 'surname'
      else if (common.has(norm)) kind = 'stop'
      else if (calendar.has(norm) || calendar.has(norm.replace(/'s$/, '')))
        kind = 'calendar'
      else kind = 'part'
    } else if (/^\p{Lu}$/u.test(word) && word !== 'I' && word !== 'A')
      // "Jordan S": one capital next to a name part is an initial.
      kind = 'initial'
    else if (particleWords.has(word)) kind = 'particle'
    const start = at + lead
    out.push({
      kind,
      start,
      end: start + word.length,
      norm,
      opens: lead > 0,
      closes: tail !== '',
      upper: /^\p{Lu}/u.test(word)
    })
  }
  return out
}

/** The tokens that may make a name together, split at anything else. */
function groupsOf(tokens: readonly Token[]) {
  const groups: { tokens: Token[]; next: Token | undefined }[] = []
  let current: Token[] = []
  const close = (next: Token | undefined) => {
    if (current.length) groups.push({ tokens: current, next })
    current = []
  }
  tokens.forEach((t, i) => {
    // "Jordan Little": a common word that is also a surname ends a name
    // right after a name's part; anywhere else it is a common word.
    if (t.kind === 'surname') {
      if (t.opens || current.at(-1)?.kind !== 'part') return close(t)
      current.push({ ...t, kind: 'part' })
      return close(tokens[i + 1])
    }
    if (t.kind === 'stop') return close(t)
    if (t.opens || t.kind === 'title') close(t)
    current.push(t)
    if (t.closes) close(tokens[i + 1])
  })
  close(undefined)
  return groups
}

const runOf = (tokens: readonly Token[]) => tokens.map((t) => t.norm).join(' ')
const counted = (t: Token) =>
  t.kind === 'part' || t.kind === 'initial' || t.kind === 'calendar'

/** The part of a group that is a person's name, or null. */
function nameIn(
  group: { tokens: Token[]; next: Token | undefined },
  own: OwnWords
): Token[] | null {
  const all = group.tokens
  let lo = 0
  let hi = all.length
  const trim = () => {
    while (lo < hi && all[lo]!.kind === 'particle') lo++
    while (hi > lo && all[hi - 1]!.kind === 'particle') hi--
  }
  trim()
  // "Vitamin D. Then": one capital that ends a sentence is no initial
  // ("Jordan S.:" or "Jordan S.," is one).
  const end = all[hi - 1]
  if (
    end?.kind === 'initial' &&
    end.norm.length === 1 &&
    !end.closes &&
    hi === all.length &&
    group.next?.upper
  ) {
    hi--
    trim()
  }
  if (lo >= hi) return null
  const run = (a: number, b: number) => runOf(all.slice(a, b))
  // The store's own words: the whole group, or a run of two or three at
  // either end ("Cedar Goods Co.", a product title).
  if (hi - lo <= 3 && ownHas(own, run(lo, hi))) return null
  for (let moved = true; moved && lo < hi;) {
    moved = false
    for (const n of [3, 2]) {
      if (hi - lo < n) continue
      if (ownHas(own, run(lo, lo + n))) {
        lo += n
        moved = true
        break
      }
      if (ownHas(own, run(hi - n, hi))) {
        hi -= n
        moved = true
        break
      }
    }
    trim()
  }
  if (lo >= hi) return null
  const title = all[lo]!.kind === 'title'
  let others = 0
  for (let i = lo; i < hi; i++)
    if (all[i]!.kind === 'part' || all[i]!.kind === 'initial') others++
  // Calendar words at the ends go while two other parts are left
  // ("Happy Mother's Day Jordan Sample" keeps the day).
  if (!title)
    while (lo < hi && all[lo]!.kind === 'calendar' && others >= 2) lo++
  while (hi > lo && all[hi - 1]!.kind === 'calendar' && others >= 2) hi--
  const name = all.slice(lo, hi)
  const parts = name.filter(counted)
  if (title) return parts.length >= 1 ? name : null
  if (parts.length < 2 || parts.every((x) => x.kind === 'calendar')) return null
  return name
}

/** Whether a line names someone (two name parts, a title and a name). */
const hasName = (line: string, own: OwnWords) =>
  groupsOf(tokensOf(line)).some((g) => nameIn(g, own) !== null)

/** People's names out; the store's own words, the calendar and headings kept. */
function withoutNames(line: string, own: OwnWords) {
  let out = ''
  let at = 0
  for (const g of groupsOf(tokensOf(line))) {
    const name = nameIn(g, own)
    if (!name) continue
    out += `${line.slice(at, name[0]!.start)}[name]`
    at = name.at(-1)!.end
  }
  return out + line.slice(at)
}

const redact = (line: string, own: OwnWords) =>
  withoutNames(
    phones(
      line
        .replace(email, '[email]')
        .replace(link, '[link]')
        .replace(handle, '[handle]')
    ).replace(longNumber, '[number]'),
    own
  )

/** The owner's words in a text: a placeholder is not one. */
const count = (text: string) =>
  text
    .replace(/\[[a-z ]{2,20}\]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/** Cut at `max` on a word, never inside a character written as two units. */
function cut(text: string, max: number) {
  if (text.length <= max) return text
  const head = text.slice(0, max + 1)
  const at = head.search(/\s\S*$/)
  const kept = at > 0 ? head.slice(0, at) : text.slice(0, max)
  const last = kept.charCodeAt(kept.length - 1)
  return (last >= 0xd800 && last <= 0xdbff ? kept.slice(0, -1) : kept).trimEnd()
}

function excerptOf(source: string, own: OwnWords) {
  const lines = untag(visible(source))
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line !== footerMark && !footerWords.test(line))
  return (
    withoutReviews(lines, own)
      .map((line) => (line ? redact(line, own) : line))
      // A line with an address is about the address, never voice; a line
      // with none of the owner's words (only placeholders) says nothing.
      .filter(
        (line) =>
          !line || (!addresses.some((a) => a.test(line)) && count(line) > 0)
      )
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * One email's words as a voice excerpt, or null when it says too little.
 * `own` is the store's own words a name check keeps (its name, its
 * product titles).
 */
export function voiceExcerpt(
  body: MessageBody,
  own: readonly string[] | OwnWords = []
): VoiceExcerpt | null {
  const ours = 'runs' in own ? own : ownWordsOf(own)
  // The plain-text part when it says enough, else the HTML.
  const fromText = body.text?.trim()
    ? excerptOf(body.text.slice(0, GMAIL_CLIP_BYTES), ours)
    : ''
  const text =
    count(fromText) >= minExcerptWords
      ? fromText
      : excerptOf(visibleLines(body.html), ours)
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
