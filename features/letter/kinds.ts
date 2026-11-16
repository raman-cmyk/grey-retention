import { amount, hiddenChars, oneLine } from '@/features/assembly/assemble'
import { usableMaterial } from '@/features/assembly/inputs'
import { checkCopy } from '@/features/copy-qa/check'
import { strayPrices, typedLink } from '@/features/email-build/inspect'
import type { LetterProblem } from './checks'
import {
  letterText,
  letterWords,
  linksIn,
  seenText,
  wordCount,
  type Letter
} from './letter'
import type { LetterBrief } from './writer'
import { kindWhen, letterKinds, type LetterKind } from './kind-list'

export { letterKinds, type LetterKind }

/**
 * DST-PIC #24 ("Library of text email types"): a text email can be one of
 * five kinds, each with its own rules: a founder note, a quick question,
 * a "we miss you", a launch teaser and a thank-you. The Letter writer is
 * told its kind's rules, and code checks what it can of each (its links,
 * its length, the question a quick question asks, the thanks a thank-you
 * opens with, the guilt a "we miss you" never lays); a letter that breaks
 * one goes back with the reason, as every other check's (D21).
 *
 * A kind fits a brief or not (`kindFits`): a founder note needs the
 * founder's own note, and a quick question or a launch teaser never
 * carries an offer. A founder note never tells a story of the writer's:
 * the founder's own note is placed in it word for word (`placedNote`),
 * and only a note that passes copy QA's discount, code, claim and banned
 * word rules and the price check on its own (as the designed founder note
 * section's words are judged with the email): the writer is never sent
 * back for words it cannot change, so a note that fails is no founder
 * note.
 *
 * The kinds hold for the writer's letters only: the plain letter (no AI,
 * or after the rewrites) is the same short note for every kind.
 */

export type KindSpec = {
  /** The owner's name for it. */
  name: string
  /** When it is the right letter (the planner's guide). */
  when: string
  /** What the Letter writer is told. */
  rules: readonly string[]
  /** It may carry the locked offer's line. */
  offer: boolean
  /** The most links its text writes. */
  links: 1 | 2
  /** Its words, inside the letter's own range. */
  words: { min: number; max: number }
}

export const kindSpecs: Record<LetterKind, KindSpec> = {
  founder_note: {
    name: 'Founder note',
    when: kindWhen.founder_note,
    rules: [
      'This letter is a founder note: the founder writes it, in the first person ("I"), to a customer they know.',
      'The founder’s own note ("founderNote" in Data) is placed in the letter word for word by the system, after your first paragraph. Write one short paragraph that opens it, and one or two after it that close it with a link: at most 3 paragraphs of your own. Never retell, quote or change the note, and tell no story of your own.'
    ],
    offer: true,
    links: 2,
    words: letterWords
  },
  quick_question: {
    name: 'Quick question',
    when: kindWhen.quick_question,
    rules: [
      'This letter is a quick question: ask the reader one simple question they can answer in a few words, and ask them to reply.',
      'Put the question in the last paragraph or the P.S., and ask only that one. Sell nothing: one link at most, and no offer.'
    ],
    offer: false,
    links: 1,
    words: { min: letterWords.min, max: 150 }
  },
  we_miss_you: {
    name: 'We miss you',
    when: kindWhen.we_miss_you,
    rules: [
      'This letter is a "we miss you", to someone who has not shopped or read in a while: warm and short, glad to write to them, with one reason to come back.',
      'Never make them feel guilty: never say they have not bought, opened or visited, that they have been away, or that you noticed.'
    ],
    offer: true,
    links: 2,
    words: { min: letterWords.min, max: 180 }
  },
  launch_teaser: {
    name: 'Launch teaser',
    when: kindWhen.launch_teaser,
    rules: [
      'This letter is a launch teaser: something new from the store. Say what it is and why it is worth a look, and keep a little back.',
      'No offer, one link at most, and never a launch date, a time or a "coming soon" a fact does not state.'
    ],
    offer: false,
    links: 1,
    words: { min: letterWords.min, max: 180 }
  },
  thank_you: {
    name: 'Thank-you',
    when: kindWhen.thank_you,
    rules: [
      'This letter is a thank-you: thank the reader in the greeting or the first paragraph, for being a customer or for reading along.',
      'Sell nothing in the first paragraph and put no link in it. An offer may close the letter, as a small thank-you.'
    ],
    offer: true,
    links: 2,
    words: letterWords
  }
}

/** The most words of the founder's note a founder note places. */
export const maxNoteWords = 150

/**
 * The founder's own note, as a founder note places it, or null when the
 * store has none it can place: the founder's confirmed note
 * (`usableMaterial`), each paragraph plain words only (no hidden
 * characters, no { } < > [ ] signs, no web or email address), at most
 * `maxNoteWords` words.
 */
export function founderNote(brief: LetterBrief): string[] | null {
  const note = usableMaterial(brief.locked.input).founder?.note ?? []
  if (!note.length) return null
  const typed = new RegExp(typedLink.source, 'i')
  const plain = note.every(
    (p) =>
      p.trim() === oneLine(p, 600) &&
      !hiddenChars.test(p) &&
      !/[{}<>[\]\\]/.test(p) &&
      !typed.test(p)
  )
  if (!plain) return null
  const words = note.reduce((n, p) => n + wordCount(p), 0)
  if (words > maxNoteWords) return null
  // The hard rules hold for the founder's words too (VISION §3 rules 6, 7).
  const input = brief.locked.input
  const qa = checkCopy({
    draft: {
      subject: '',
      preview: '',
      // One block, as the designed founder note section is judged.
      blocks: [{ id: 'note', text: note.join('\n') }]
    },
    facts: input.facts,
    maxDiscountPercent: input.maxDiscountPercent,
    codes: [...input.codes],
    productNames: [...input.products.map((p) => p.title), brief.brandName],
    sendAt: input.sendAt
  })
  const prices = new Set(
    input.products
      .map((p) => amount(p.price))
      .filter((n): n is number => n !== null)
  )
  const store = [brief.brandName, ...input.products.map((p) => p.title)]
  if (
    qa.failures.length ||
    note.some((p) => strayPrices(masked(p, store), prices).length)
  )
    return null
  return note.map((p) => p.trim())
}

/** Why a kind does not fit the brief (null: it fits). */
export function kindFits(
  kind: LetterKind,
  brief: LetterBrief
): 'kind_needs_founder_note' | 'kind_never_offers' | null {
  if (kind === 'founder_note' && !founderNote(brief))
    return 'kind_needs_founder_note'
  if (!kindSpecs[kind].offer && brief.locked.offer) return 'kind_never_offers'
  return null
}

/** The brief's kind when it fits, else none (a plain short letter). */
export const kindOf = (brief: LetterBrief): LetterKind | undefined =>
  brief.kind &&
  Object.hasOwn(kindSpecs, brief.kind) &&
  !kindFits(brief.kind, brief)
    ? brief.kind
    : undefined

/** The founder's note a founder note places, else none. */
export const placedNote = (brief: LetterBrief) =>
  kindOf(brief) === 'founder_note' ? founderNote(brief) : null

/** The most paragraphs of a founder note's writer: the note goes between. */
export const founderParagraphs = 3

/** The letter as `letterFrom` makes it: the note right after paragraph 1. */
const placedIn = (letter: Letter, note: readonly string[]) =>
  letter.body.length > note.length &&
  note.every((p, i) => letter.body[1 + i] === p)

/**
 * The paragraphs the writer wrote: the body without the founder's placed
 * note (found where it is placed, never by its words, so a paragraph that
 * copies it is still the writer's).
 */
export function writerBody(letter: Letter, brief: LetterBrief): string[] {
  const note = placedNote(brief)
  return note && placedIn(letter, note)
    ? [letter.body[0]!, ...letter.body.slice(1 + note.length)]
    : letter.body
}

/** The rules the Letter writer is told for its kind, with their numbers. */
export function kindRules(brief: LetterBrief): string[] {
  const kind = kindOf(brief)
  if (!kind) return []
  const spec = kindSpecs[kind]
  const note = placedNote(brief)
  const noted = note ? note.reduce((n, p) => n + wordCount(p), 0) : 0
  const length = note
    ? `The founder’s note has ${noted} words; with yours the letter is ${letterWords.min} to ${letterWords.max} words: write ${noted >= letterWords.min ? `up to ${letterWords.max - noted}` : `${letterWords.min - noted} to ${letterWords.max - noted}`} words of your own, in at most ${founderParagraphs} paragraphs.`
    : `Write ${spec.words.min} to ${spec.words.max} words in the paragraphs and the P.S. together.`
  return [...spec.rules, length]
}

/** Words that lay guilt on a reader who has been away (absence, never warmth). */
const absent =
  '(?:bought|ordered|shopped|opened|read|visited|been back|been in|come back|came back|stopped by|clicked)'
/** After "didn't", the same in the base form. */
const absentBase = '(?:buy|order|shop|open|read|visit|come back|stop by|click)'
const guilt = new RegExp(
  [
    `\\byou (?:haven['’]t|have not|hadn['’]t|had not)(?: \\w+)? ${absent}\\b`,
    `\\byou (?:didn['’]t|did not)(?: \\w+)? ${absentBase}\\b`,
    `\\bwe(?:['’]ve| have)? noticed (?:that )?you\\b`,
    `\\bwhere (?:have )?you been\\b`,
    `\\bwe (?:haven['’]t|have not) (?:seen|heard from) you\\b`,
    `\\bsince we(?:['’]ve| have)? (?:last )?(?:seen|heard from) you\\b`,
    `\\bsince you last ${absent}\\b`,
    `\\byou(?:['’]ve| have)? (?:been away|forgotten (?:about )?us|forgot (?:about )?us|left us|stopped (?:buying|ordering|shopping|opening|reading|visiting))\\b`
  ].join('|'),
  'i'
)
const firstPerson = /\b(?:i|i['’]m|i['’]ve|i['’]d|i['’]ll|my|me)\b/i
/** Thanks, as words ("Thanksgiving" and "thankfully" thank no one). */
const thanks =
  /\b(?:thank[\s-]you|thanks|thankful|grateful|gratitude|appreciate|appreciated|appreciation)\b/i

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** `text` with the store's own words (its name, titles) blanked out. */
const masked = (text: string, own: readonly string[]) =>
  own
    .filter((t) => t.trim().length >= 2)
    .sort((a, b) => b.length - a.length)
    .reduce((t, o) => t.replace(new RegExp(escape(o), 'gi'), ' '), text)

/**
 * What a written letter breaks of its kind's rules, in plain words for the
 * writer (empty: nothing, or no kind). The founder's placed note is not the
 * writer's, so it is never judged as theirs.
 */
export function kindProblems(
  letter: Letter,
  brief: LetterBrief
): LetterProblem[] {
  const kind = kindOf(brief)
  if (!kind) return []
  const spec = kindSpecs[kind]
  const problems: LetterProblem[] = []
  const add = (rule: string, reason: string) => problems.push({ rule, reason })
  const note = placedNote(brief) ?? []
  const own = [
    ...writerBody(letter, brief),
    ...(letter.ps ? [letterText(letter).at(-1)!] : [])
  ]
  const words = letterText(letter).reduce((n, t) => n + wordCount(t), 0)
  // The letter's own limits have their own reason (`letterProblems`).
  const inLetter = words >= letterWords.min && words <= letterWords.max
  if (inLetter && (words < spec.words.min || words > spec.words.max))
    add(
      'kind_length',
      `A ${spec.name.toLowerCase()} is ${spec.words.min} to ${spec.words.max} words; this one is ${words}.`
    )
  const links = own.flatMap(linksIn).length
  if (links > spec.links)
    add(
      'kind_links',
      `A ${spec.name.toLowerCase()} has ${spec.links === 1 ? 'one link at most' : 'two links at most'}; this one has ${links}.`
    )
  if (letter.offer && !spec.offer)
    add('kind_offer', `A ${spec.name.toLowerCase()} never has an offer.`)
  const store = [
    brief.brandName,
    ...brief.locked.input.products.map((p) => p.title)
  ]
  const seen = own.map((t) => masked(seenText(t), store))
  if (kind === 'founder_note') {
    if (!seen.some((t) => firstPerson.test(t)))
      add(
        'kind_first_person',
        'The founder writes a founder note: write your paragraphs in the first person ("I").'
      )
    // A short line of the note ("Thank you.") is a copy only as a whole.
    const copies = (t: string, p: string) =>
      wordCount(p) >= 6 ? t.includes(p) : t.trim() === p
    if (own.some((t) => note.some((p) => copies(t, p))))
      add(
        'kind_note_quoted',
        'Never repeat the founder’s note: the system places it once, after your first paragraph.'
      )
    if (writerBody(letter, brief).length > founderParagraphs)
      add(
        'kind_paragraphs',
        `Write at most ${founderParagraphs} paragraphs of your own: the founder’s note goes between them.`
      )
  }
  if (kind === 'quick_question') {
    const end = [letter.ps, letter.body.at(-1)].filter((t): t is string => !!t)
    if (!end.some((t) => seenText(t).includes('?')))
      add(
        'kind_question',
        'Ask your one question in the last paragraph or the P.S., with a question mark.'
      )
    const asked = seen.join(' ').match(/\?/g)?.length ?? 0
    if (asked > 2)
      add(
        'kind_questions',
        `A quick question asks one question; this letter has ${asked} question marks.`
      )
  }
  if (kind === 'we_miss_you') {
    const all = [
      masked(letter.subject, store),
      masked(letter.preheader, store),
      ...seen
    ].join('\n')
    const found = all.match(guilt)
    if (found)
      add(
        'kind_guilt',
        `“${found[0]}” makes the reader feel guilty: say you are glad to write to them instead.`
      )
  }
  if (kind === 'thank_you') {
    const first = letter.body[0] ?? ''
    if (!thanks.test(`${letter.greeting ?? ''} ${seenText(first)}`))
      add(
        'kind_thanks',
        'A thank-you thanks the reader in the greeting or the first paragraph.'
      )
    if (linksIn(first).length)
      add(
        'kind_first_link',
        'Put no link in a thank-you’s first paragraph: thank the reader first.'
      )
  }
  return problems
}
