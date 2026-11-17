import { fold } from './pages'

/**
 * REL-ONB2 part d: the founder's own note on the store's About page, only
 * when it is provably the page's own words and theirs. "Create email" may
 * place a founder's note only word for word from the store's own pages
 * (the owner's rule of 16 November: nothing invented), so the Site reader
 * keeps a founder finding only when code proves, on the page itself:
 *
 * - the page is the About page by its address (`aboutPage`: never the
 *   reviews, testimonials or a customer's story);
 * - the quote is whole sentences of the page (`wholeSentences`): it starts
 *   where a block starts or after another sentence's stop, ends at its own
 *   stop followed by the block's end or the next sentence, its quote marks
 *   balanced; whitespace is folded, but the letters are the page's (never
 *   the model's capitals or quote marks);
 * - it is written in the first person singular and about no one else
 *   (`firstPerson`): an "I", "my" or "me"; never "she", "her", "his",
 *   "says", "wrote" and the like, and never a word of the founder's name
 *   outside their introduction of themself ("Maya taught me…" is a bio);
 * - it is tied to the founder by their own words (`introduced`): they
 *   introduce themself in it, just before it in its block, or in the block
 *   right before it ("<h2>Hi, I'm Maya!</h2>"), with no other block, name,
 *   quote or third person in between, and never for a quotation; or it is
 *   signed by them with a dash or a closing, at its own end ("“I test every
 *   sample.” – Maya") or in the block right after it ("— Maya", "Love,
 *   Maya"), with nothing after the name but a role ("founder of Cedar
 *   Lane"). A block before it that introduces or names someone else, or a
 *   credit or caption naming anyone else after it, refuses it;
 * - the founder's name is a person's (`personName`) on the page word for
 *   word (`onPage`), and a role is kept only from a block that also names
 *   them (`roleOf`).
 *
 * Over-blocking is the safer mistake: a note it refuses is no founder's
 * note in an email, never someone else's words under their name.
 */

/** The page's blocks (headings, paragraphs), each on its own line. */
const blocksOf = (text: string) => text.split('\n').map(fold).filter(Boolean)

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
/** A quote mark the model may have straightened or curled. */
const marks: Record<string, string> = {
  "'": "['‘’]",
  '‘': "['‘’]",
  '’': "['‘’]",
  '"': '["“”]',
  '“': '["“”]',
  '”': '["“”]'
}
/** A quote's letters as a pattern: case, line breaks and quote marks aside. */
const pattern = (quote: string) =>
  Array.from(quote)
    .map((c) => (c === ' ' ? '[ \\n]' : (marks[c] ?? escape(c))))
    .join('')

/** An About page by its address, in any locale: never reviews or a customer's story. */
const aboutPath =
  /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?(?:\/pages)?\/(about(?:-[a-z0-9]+)*|our-story|story|the-story|our-founder|meet-the-founder|meet-the-maker|who-we-are)\/?$/i
export function aboutPage(url: string): boolean {
  try {
    const page = aboutPath.exec(new URL(url).pathname)
    return !!page && !/review|testimonial|customer/i.test(page[1]!)
  } catch {
    return false
  }
}

/** Marks around a sentence: before it ("“I…") and after its stop ("…wool.”"). */
const openers = /["'“‘(«]*$/u
const closers = /^["'”’»)\]]*/u
const stop = /[.!?…]["'”’»)\]]*$/u
/** A stop after an initial or an abbreviation ends no sentence ("J. Smith", "9 a.m. every day"). */
const initial = /(?:^|[^\p{L}\p{N}])\p{Lu}\.["'”’»)\]]*$/u
const abbreviation =
  /(?:^|[^\p{L}\p{N}])(?:mr|mrs|ms|mx|dr|prof|st|sr|jr|vs|inc|ltd|co|no|mt|etc|approx|e\.g|i\.e|a\.m|p\.m)\.["'”’»)\]]*$/iu

/** Whether a text ends a sentence: its stop, never an abbreviation's. */
const endsSentence = (text: string) => {
  const t = text.trimEnd()
  return stop.test(t) && !initial.test(t) && !abbreviation.test(t)
}

/** A sentence starts with a capital or a number, after its opening marks. */
const capital = /^["'“‘(«]*[\p{Lu}\p{N}]/u
/**
 * What may follow a sentence: its block's end, a space and the next
 * sentence, or a dash and a name crediting it ("… myself.” – Maya": the
 * credit is not stored, and `introduced` takes only the founder's).
 */
const nextSentence = /^(?:$|\n| ["'“‘(«\p{Lu}\p{N}]| [–—-] ?\p{Lu})/u

const count = (text: string, mark: string) => text.split(mark).length - 1
/** Quote marks and brackets in pairs: never half of someone's quote. */
const balanced = (t: string) =>
  count(t, '“') === count(t, '”') &&
  count(t, '«') === count(t, '»') &&
  count(t, '"') % 2 === 0 &&
  count(t, '(') === count(t, ')') &&
  count(t, '‘') <= count(t, '’')

/** Where a note is on its page: its words, and the rest of its blocks around it. */
export type Spot = {
  note: string
  /** Its place in the page's text, for page order. */
  at: number
  /** The block it starts in, before it; the block it ends in, after it. */
  before: string
  after: string
  /** The block right before the one it starts in, and right after the one it ends in. */
  previous?: string
  next?: string
  /** It is in one of the page's block quotes: someone quoted. */
  quoted?: boolean
}

/**
 * The quote as the page writes it, when it is whole sentences of the
 * page: whitespace folded (a line break as a space), every letter and mark
 * the page's own, with the page's quote marks around it. Null when the
 * page does not hold it, or holds it only as part of a sentence.
 */
export function wholeSentences(text: string, quote: string): Spot | null {
  const page = blocksOf(text).join('\n')
  const words = fold(quote)
  if (!words) return null
  for (const m of page.matchAll(new RegExp(pattern(words), 'giu'))) {
    // The page's own marks around it belong to it.
    const start = m.index - openers.exec(page.slice(0, m.index))![0].length
    const tail = page.slice(m.index + m[0].length)
    const end = m.index + m[0].length + closers.exec(tail)![0].length
    const found = page.slice(start, end)
    const before = page.slice(0, start)
    const after = page.slice(end)
    const starts =
      before === '' ||
      before.endsWith('\n') ||
      (before.endsWith(' ') && endsSentence(before))
    if (
      starts &&
      capital.test(found) &&
      endsSentence(found) &&
      nextSentence.test(after) &&
      balanced(found) &&
      // A block inside it ends a sentence too (never a heading run on).
      found
        .split('\n')
        .slice(0, -1)
        .every((line) => endsSentence(line))
    ) {
      const blocks = page.split('\n')
      const first = before.split('\n').length - 1
      const last = page.slice(0, end).split('\n').length - 1
      return {
        note: fold(found),
        at: start,
        before: before.slice(before.lastIndexOf('\n') + 1),
        after: after.split('\n')[0] ?? '',
        previous: blocks[first - 1],
        next: blocks[last + 1]
      }
    }
  }
  return null
}

/** `wholeSentences` on a read page, marked when it sits in one of the page's block quotes. */
export function noteOn(
  page: { text: string; quotes?: readonly string[] },
  quote: string
): Spot | null {
  const spot = wholeSentences(page.text, quote)
  if (!spot) return null
  const quoted = (page.quotes ?? []).some((q) => fold(q).includes(spot.note))
  return { ...spot, quoted }
}

const titles = /^(?:dr|mr|mrs|ms|miss|mx|prof|sir|dame)\.?$/i
/** The name's own words, without a title ("Dr. Maya Lee": Maya, Lee). */
const nameWords = (name: string) =>
  fold(name)
    .split(' ')
    .filter((w) => w && !titles.test(w))

/** Words that are no one's name ("Founder", "Our story", "Hi", "I"). */
const notNames = new Set(
  (
    'founder cofounder co-founder owner maker creator designer artist director ceo boss team family friends ' +
    'our my your his her their the a an and of from with by for at in to us me hi hello hey dear welcome meet ' +
    'thanks love story about shop store studio brand company home'
  ).split(' ')
)

/**
 * Whether a name is one person's: 1 to 4 words, each a capital and at
 * least two letters ("Maya Lee", "Dr. Ana Ruiz", "Mary-Jane O’Neil"),
 * never a common or role word ("Founder", "Our story") or a title alone.
 */
export function personName(name: string): boolean {
  const words = fold(name).split(' ').filter(Boolean)
  return (
    words.length >= 1 &&
    words.length <= 4 &&
    !titles.test(words.at(-1)!) &&
    words.every((w) => {
      const bare = w.replace(/\.$/, '')
      return (
        /^\p{Lu}[\p{L}\p{M}'’-]*$/u.test(bare) &&
        Array.from(bare.replace(/[^\p{L}]/gu, '')).length >= 2 &&
        !notNames.has(bare.toLowerCase())
      )
    })
  )
}

/** The founder as they may name themself: "Dr. Maya Lee", "Maya Lee", "Maya". */
const nameForms = (name: string) => {
  const words = nameWords(name)
  return [
    fold(name),
    ...words.map((_, i) => words.slice(0, words.length - i).join(' '))
  ]
    .filter((w, i, all) => w && all.indexOf(w) === i)
    .sort((a, b) => b.length - a.length)
}

/**
 * "I'm Maya", "I am Maya Lee", "My name is Maya", "Maya here", and in the
 * note itself "This is Maya" (before a note it may present someone else's
 * words: "This is Maya." then a customer's).
 */
function introductions(name: string, inNote = true): RegExp | null {
  if (!nameWords(name).length) return null
  const who = nameForms(name)
    .map((w) => escape(w).replace(/ /g, '\\s+'))
    .join('|')
  const lead = inNote
    ? String.raw`I['’]m|I am|[Mm]y name is|[Mm]y name['’]s|[Tt]his is`
    : String.raw`I['’]m|I am|[Mm]y name is|[Mm]y name['’]s`
  return new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:(?:${lead})\s+(?:${who})|(?:${who})\s+here)(?![\p{L}\p{N}])`,
    'gu'
  )
}

const word = String.raw`\p{Lu}[\p{L}\p{M}'’-]*`
/** Anyone introducing themself: "I'm Tom", "My name is Ana Ruiz", "Hi, Tom here". */
const anyIntro = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:(?:I['’]m|I am|[Mm]y name is|[Mm]y name['’]s|[Tt]his is)\s+(${word}(?:\s+${word}){0,3})|(?:^|(?:hi|hello|hey)[,!]?\s+)(${word}(?:\s+${word}){0,3})\s+here)(?![\p{L}\p{N}])`,
  'giu'
)

const notLetter = String.raw`[^\p{L}\p{N}'’]`
const firstPersonWord = new RegExp(
  String.raw`(?:^|${notLetter})(?:I(?:['’](?:m|ve|d|ll))?|[Mm]y|[Mm]e|[Mm]ine|[Mm]yself)(?=$|${notLetter})`,
  'u'
)
/** Someone written about or quoted: never the writer's own words ("In her words"). */
const aboutSomeone =
  /(?<![\p{L}\p{N}])(?:she|he|her|hers|herself|him|his|himself|says|said|writes|wrote)(?![\p{L}\p{N}])/iu

/** A text without the store's own names and the founder's introductions of themself. */
function withoutOwn(text: string, name: string, allowed: readonly string[]) {
  let t = text
  for (const a of [...allowed].sort((x, y) => y.length - x.length))
    if (a.trim().length > 1) t = t.split(a.trim()).join(' ')
  const intro = introductions(name)
  return intro ? t.replace(intro, ' ') : t
}

/**
 * Whether a note is the founder's own, in the first person singular and
 * about no one else: an "I", "my" or "me"; never "she", "her", "his",
 * "says" or "wrote"; and no word of the founder's name except where they
 * introduce themself ("I'm Maya", "Maya here") or in the store's own
 * names (`allowed`: the brand's). "Maya taught me to knit" is a bio.
 */
export function firstPerson(
  note: string,
  name: string,
  allowed: readonly string[] = []
): boolean {
  if (!firstPersonWord.test(note) || aboutSomeone.test(note)) return false
  const rest = withoutOwn(note, name, allowed)
  return !nameWords(name)
    .map((w) => w.replace(/[.,]$/, ''))
    .filter((w) => Array.from(w).length >= 2)
    .some((w) =>
      new RegExp(
        String.raw`(?<![\p{L}\p{N}])${escape(w)}(?![\p{L}\p{N}])`,
        'iu'
      ).test(rest)
    )
}

/** Capital words that start a sentence without naming anyone. */
const plainStarts = new Set(
  "The This That It It’s It's We Our My So And But Or When Then Now Today After Before Every Each In On At For Since Back Hi Hello Hey Welcome Thank Thanks".split(
    ' '
  )
)
const capitals = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{M}'’-]*/gu
const mine = /^I(?:['’](?:m|ve|d|ll))?$/u

/** Capitalised words a heading or caption is made of, never a name. */
const everyday = new Set([
  ...notNames,
  ...[...plainStarts].map((w) => w.toLowerCase()),
  ...(
    'meet about values mission vision people hands workshop made handmade since all new free more see read ' +
    'browse shipping returns care guide size sizes materials process how why what where who you yours ' +
    'sincerely warmly cheers best regards head lead chief'
  ).split(' ')
])
/** What a review's credit carries: stars, "verified", "customer", "buyer", "review". */
const reviewed =
  /[★☆⭐✩✪✫✬✭✮✯]|(?<![\p{L}\p{N}])(?:verified|customers?|buyers?|reviews?|reviewers?|reviewed)(?![\p{L}\p{N}])/iu
/** A capitalised word, or an initial with its dot ("Anna", "K."). */
const nameTokens =
  /(?<![\p{L}\p{N}])\p{Lu}(?:\.(?=$|[\s,;)])|[\p{L}\p{M}'’-]*)/gu

/**
 * Whether a short line names or credits someone else: a review's marks, or
 * a capitalised word or initial that is not the founder's, the store's or
 * an everyday word ("Anna K.", "Anna from Leeds", "★★★★★ Anna", "Meet Tom",
 * "Our packer, Tom", "Verified buyer").
 */
function namesSomeoneElse(
  line: string,
  name: string,
  own: ReadonlySet<string>
): boolean {
  if (reviewed.test(line)) return true
  const initials = nameWords(name).map((w) => Array.from(w)[0])
  for (const [w] of line.matchAll(nameTokens)) {
    if (w.endsWith('.')) {
      if (!initials.includes(w[0])) return true
      continue
    }
    if (
      Array.from(w).length === 1 ||
      own.has(w) ||
      mine.test(w) ||
      everyday.has(w.toLowerCase())
    )
      continue
    return true
  }
  return false
}

/** How many words a heading or a caption has at most. */
const shortLine = 8
const short = (line: string) => fold(line).split(' ').length <= shortLine

const dash = /^[–—-]\s*/u
/** Short closings before a sign-off's name ("Love, Maya", "xx Maya"). */
const closing =
  /^(?:(?:with\s+)?love,?|thanks,|thank\s+you,|warmly,|x{1,3})\s+/iu
const roles = new Set(
  'founder co-founder cofounder owner maker designer creator'.split(' ')
)

/**
 * Only a role after a sign-off's name: "founder", "co-founder and maker",
 * "founder & owner", "owner of Cedar Lane" (the store's own name only).
 * Anything else ("a happy customer", "packing orders", "at the studio")
 * is no role.
 */
function roleOnly(text: string, own: ReadonlySet<string>) {
  const t = text.trim().replace(/[.!]+$/, '')
  if (!t) return true
  const [, kinds = '', of] = /^(.*?)(?:\s+of\s+(.+))?$/iu.exec(t) ?? []
  const words = kinds.split(/\s*(?:,|&|\/|\s)\s*/u).filter(Boolean)
  return (
    words.some((w) => roles.has(w.toLowerCase())) &&
    words.every(
      (w) => roles.has(w.toLowerCase()) || /^(?:and|the)$/i.test(w)
    ) &&
    (of === undefined ||
      fold(of)
        .split(' ')
        .every((w) => own.has(w)))
  )
}

/**
 * Whom a line credits. A sign-off, with a dash or a short closing ("—
 * Maya", "Love, Maya"): "founder" for the founder's own name with at most
 * a role after it, "other" for anything else. A line without one is no
 * credit (a heading of the founder's name is not their signature), but a
 * short one naming someone else ("Tom Hart", "Anna, a customer") is
 * "other": a caption or a credit to them.
 */
function creditOf(
  text: string,
  name: string,
  own: ReadonlySet<string>
): 'founder' | 'other' | null {
  const t = fold(text)
  const body = t.replace(dash, '')
  const signed = body !== t || closing.test(body)
  const [who = '', ...rest] = body.replace(closing, '').split(',')
  const person = who.replace(/[.!]+$/, '').trim()
  const founder = nameForms(name).includes(person)
  if (signed)
    return founder && roleOnly(rest.join(','), own) ? 'founder' : 'other'
  return short(t) && namesSomeoneElse(t, name, own) ? 'other' : null
}

/**
 * Whether a text introduces or names someone else: "Hi, I'm Tom!", "Tom
 * here", or a line of another's name ("Tom Hart", "Tom Hart, designer").
 */
function namesAnother(
  text: string | undefined,
  name: string,
  own: ReadonlySet<string>,
  line: boolean
): boolean {
  if (!text) return false
  const forms = nameForms(name)
  for (const m of text.matchAll(anyIntro)) {
    const who = fold(m[1] ?? m[2] ?? '')
    const theirs = forms.some((f) => who === f || who.startsWith(`${f} `))
    if (!theirs && personName(who) && !who.split(' ').every((w) => own.has(w)))
      return true
  }
  return line && creditOf(text, name, own) === 'other'
}

/**
 * Whether the note is tied to the founder in the page's own words: it
 * introduces them itself; it is signed by them, with a dash or a closing,
 * at its own end ("– Maya") or in the block right after it ("— Maya",
 * "Love, Maya"); or, when it is no quotation, the sentence just before it
 * in its block introduces them, or the block right before it does when it
 * starts its own, with no one else named, quoted or written about in
 * between and no colon presenting it. Refused, whatever credit follows:
 * a block before it that introduces or names someone else, a credit or
 * caption naming anyone else after it, an attribution ("says Tom"). The
 * store's own names (`allowed`) are no one else's.
 */
export function introduced(
  spot: Spot,
  name: string,
  allowed: readonly string[] = []
): boolean {
  const intro = introductions(name)
  if (!intro) return false
  const own = new Set(
    [...nameWords(name), ...allowed.flatMap((a) => fold(a).split(' '))].map(
      (w) => w.replace(/[.,]$/, '')
    )
  )
  const tail = spot.after.trim()
  // A letter to the store before it is a customer's ("Dear Cedar Lane,").
  const toStore = (text: string | undefined) => {
    const to = /^["“]?dear\s+(.+)$/iu.exec(fold(text ?? ''))?.[1] ?? ''
    return !!to && allowed.some((a) => a.trim() && to.includes(fold(a)))
  }
  if (
    /^,?\s*(?:says|said|writes|wrote)(?![\p{L}\p{N}])/iu.test(tail) ||
    // Someone else introduced or named before it.
    namesAnother(spot.previous, name, own, true) ||
    namesAnother(spot.before, name, own, false) ||
    toStore(spot.previous) ||
    toStore(spot.before)
  )
    return false
  // A credit at its own end or in the block after it, or a caption there
  // naming anyone else, gives it to them.
  const tailCredit = dash.test(tail) ? creditOf(tail, name, own) : null
  const nextCredit =
    spot.next !== undefined ? creditOf(spot.next, name, own) : null
  if (
    tailCredit === 'other' ||
    nextCredit === 'other' ||
    (tail && !tailCredit && short(tail) && namesSomeoneElse(tail, name, own))
  )
    return false
  // Signed at its own end, or in the block right after it when it ends its own.
  const credit = tailCredit ?? (tail ? null : nextCredit)
  if (credit === 'founder' || new RegExp(intro.source, 'u').test(spot.note))
    return true
  // Introduced just before it: in its block, or in the block right before
  // when it starts its own; never for a quotation (someone else's words
  // the founder presents).
  if (spot.quoted || /^["“«‘']/u.test(spot.note)) return false
  const before = introductions(name, false)!
  const here = [...spot.before.matchAll(before)].at(-1)
  const there =
    !here && spot.before === '' && spot.previous !== undefined
      ? [...spot.previous.matchAll(before)].at(-1)
      : undefined
  const last = here ?? there
  if (!last) return false
  const between = here
    ? spot.before.slice(here.index + here[0].length)
    : `${spot.previous!.slice(last.index + last[0].length)} `
  const inner = between.trimEnd()
  return (
    // Only the rest of the sentence that introduces them, never a colon
    // presenting what follows ("…what you told me:").
    !inner.endsWith(':') &&
    !/[.!?…]["'”’»)\]]*\s/u.test(inner.slice(0, -1)) &&
    !aboutSomeone.test(between) &&
    (between.match(capitals) ?? []).every(
      (w) => own.has(w) || mine.test(w) || plainStarts.has(w)
    )
  )
}

/** A role kept only from a block that also names the founder, at most 60 characters. */
export function roleOf(
  text: string,
  name: string,
  role: string | undefined
): string | undefined {
  const r = fold(role ?? '')
  if (!r || Array.from(r).length > 60) return undefined
  return blocksOf(text).some((b) => onPage(b, name) && onPage(b, r))
    ? r
    : undefined
}

/** Whether words are on the page as they are: letters, case and all. */
export function onPage(text: string, words: string): boolean {
  const w = fold(words)
  return (
    !!w &&
    new RegExp(
      String.raw`(?:^|[^\p{L}\p{N}])${escape(w)}(?=$|[^\p{L}\p{N}])`,
      'u'
    ).test(fold(text))
  )
}
