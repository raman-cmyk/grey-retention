import { hiddenChars } from '@/features/assembly/assemble'
import {
  mask,
  phrase,
  previewRange,
  spamPhrases,
  subjectMax,
  typedLink
} from '@/features/email-build/inspect'
import { vagueLinkWords } from '@/features/email-build/accessibility'
import {
  brokenMark,
  letterText,
  letterWords,
  linkMark,
  linksIn,
  psMark,
  maxLetterLinks,
  seenText,
  visibleWords,
  wordCount,
  type Letter
} from './letter'

/**
 * TXT-001, the text checks (AGENT_MAP §4: length, at most 2 links, no
 * images, spam words, a real reply-to inbox). Code only, the same answer
 * every time. The letter's own problems go back to the Letter writer with
 * the exact reason, as a designed email's go to the Copywriter (D21); the
 * reply-to inbox is the owner's setting, so it is the owner's to fix.
 *
 * Words that come from the store (its name, product titles, the confirmed
 * founder's name and role: `own`, which the caller passes) are masked
 * first, as the designed email's checks mask them, so the writer is never
 * asked to change words it cannot. Every other part is checked, the name
 * that signs included. A
 * letter with no link passes (a quick question asks only for a reply);
 * the writer is asked for one or two.
 */
export type LetterProblem = { rule: string; reason: string }

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`
const quoted = (list: readonly string[]) => {
  const unique = [...new Set(list)]
  return unique.map((w) => `“${w}”`).join(unique.length === 2 ? ' and ' : ', ')
}
const markup = new RegExp(`[{}<>]|${hiddenChars.source}`)
const typedLinks = new RegExp(typedLink.source, 'gi')
const hidden = new RegExp(hiddenChars.source)

/** What is wrong with a letter, in plain words (empty: nothing). */
export function letterProblems(
  letter: Letter,
  own: readonly string[] = []
): LetterProblem[] {
  const problems: LetterProblem[] = []
  const add = (rule: string, reason: string) => problems.push({ rule, reason })
  const protect = own
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length)
  const read = letterText(letter)
  const words = read.reduce((n, t) => n + wordCount(t), 0)
  if (words < letterWords.min || words > letterWords.max)
    add(
      words < letterWords.min ? 'letter_too_short' : 'letter_too_long',
      `The letter is ${count(words, 'word')}; write ${letterWords.min} to ${letterWords.max}, about one idea.`
    )
  const uses = read.flatMap(linksIn)
  if (uses.length > maxLetterLinks)
    add(
      'too_many_links',
      `The letter has ${count(uses.length, 'link')}; use one or two.`
    )
  const missing = uses.filter((u) => !letter.links[u.n - 1])
  if (missing.length)
    add(
      'unknown_link',
      letter.links.length
        ? `${quoted(missing.map((u) => u.words))} ${new Set(missing.map((u) => u.words)).size === 1 ? 'points' : 'point'} to a link that does not exist: use ${letter.links.map((_, i) => `(${i + 1})`).join(' or ')}.`
        : `There is no link to point to: write ${quoted(missing.map((u) => u.words))} without one.`
    )
  if (uses.some((u) => !visibleWords(u.words)))
    add(
      'empty_link',
      'Put each link on a few words a reader can see, as [the words](1).'
    )
  // Owner pick #96: a screen reader reads a link's words alone.
  if (uses.some((u) => vagueLinkWords(u.words)))
    add(
      'vague_link',
      'Put each link on words that say where it goes, as [the candle](1), never only "here" or "click here".'
    )
  if (read.some((t) => brokenMark.test(t.replace(linkMark, ' '))))
    add(
      'broken_link',
      'Write each link exactly as [the words](1): a few words on one line in square brackets, then the link’s number in round brackets.'
    )
  if (letter.ps !== undefined && !letter.ps.replace(psMark, '').trim())
    add('empty_ps', 'Write the P.S., or leave it out.')
  // Fields drawn as written: a mark there would show as brackets.
  const plain = [
    letter.subject,
    letter.preheader,
    letter.greeting ?? '',
    letter.signoff,
    letter.signature,
    letter.role ?? ''
  ]
  if (plain.some((t) => brokenMark.test(t)))
    add(
      'link_outside_letter',
      'Put links only in the paragraphs and the P.S.: the subject, preview line, greeting, sign-off and name show every word as written.'
    )
  const drawn = [
    letter.greeting ?? '',
    ...letter.body,
    letter.signoff,
    letter.signature,
    letter.role ?? '',
    letter.ps ?? ''
  ]
  if (drawn.some((t) => hidden.test(t.replace(/[\r\n\t]/g, ' '))))
    add('hidden_characters', 'Write plain words, without hidden characters.')
  // Everything the writer wrote, as a reader sees it, store text masked.
  const seen = [...plain, ...read].map((t) => mask(seenText(t), protect))
  // An address inside the store's own words is the store's (a role such
  // as "Founder, Ritual.co"); any other is the writer's.
  const typed = [...plain, ...read]
    .flatMap((t) => [...seenText(t).matchAll(typedLinks)].map((m) => m[0]))
    .find(
      (m) => !protect.some((p) => p.toLowerCase().includes(m.toLowerCase()))
    )
  if (typed)
    add(
      'address_in_text',
      `“${typed.slice(0, 60)}” is a web or email address: never write one, put a link on a few words, as [the words](1).`
    )
  if (seen.some((t) => /[{}]/.test(t)))
    add('template_marks', 'Write no { or }: Klaviyo reads them as its own.')
  const spam = spamPhrases.filter((p) => seen.some((t) => phrase(t, p)))
  if (spam.length)
    add(
      'spam_words',
      `Leave out ${quoted(spam.slice(0, 3))}: ${spam.length === 1 ? 'it reads' : 'they read'} as spam.`
    )
  // The inbox lines, as the designed email's checks read them.
  const subject = letter.subject.trim()
  if (subject.length > subjectMax)
    add(
      'subject_too_long',
      `The subject is ${subject.length} characters; at most ${subjectMax}.`
    )
  if (markup.test(letter.subject))
    add(
      'subject_markup',
      'Write the subject in plain words, without { } < > signs or hidden characters.'
    )
  const shouting = mask(letter.subject, protect)
  if ((shouting.match(/!/g) ?? []).length > 1 || /\b[A-Z]{4,}\b/.test(shouting))
    add(
      'subject_shouting',
      'Write the subject normally: no word in capitals, at most one exclamation mark.'
    )
  const preview = letter.preheader.trim()
  if (preview.length < previewRange.min || preview.length > previewRange.max)
    add(
      'preview_length',
      `The preview line is ${count(preview.length, 'character')}; write ${previewRange.min} to ${previewRange.max}.`
    )
  if (markup.test(letter.preheader))
    add(
      'preview_markup',
      'Write the preview line in plain words, without { } < > signs or hidden characters.'
    )
  return problems
}

/** No-reply forms, as a whole part of an address (its name or a domain label). */
const noReply =
  /(?:^|[^a-z])(?:no[-_.]?repl(?:y|ies)|do[-_.]?not[-_.]?(?:reply|respond)|dont[-_.]?(?:reply|respond))(?:[^a-z]|$)/i
/** A mail system's own inbox, as the whole name (a brand called Bounce is a brand). */
const systemInbox = /^(?:bounces?|mailer[-_.]?daemon|postmaster)(?:\+.*)?$/i
const address =
  /^[a-z0-9_%+'-]+(?:\.[a-z0-9_%+'-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i

/**
 * A text email asks for a reply, so its replies must reach a person: the
 * owner's reply-to inbox, or the reason it is not one (null: it is).
 */
export function replyToProblem(replyTo: string | null | undefined) {
  const inbox = replyTo?.trim() ?? ''
  if (!inbox)
    return 'Set an inbox someone reads as the reply-to address: a text email asks people to reply.'
  if (!address.test(inbox))
    return `“${inbox.slice(0, 80)}” is not an email address: set an inbox someone reads as the reply-to address.`
  const [local, domain] = inbox.split('@') as [string, string]
  if (
    noReply.test(local) ||
    systemInbox.test(local) ||
    domain.split('.').some((label) => noReply.test(label))
  )
    return `Replies go to ${inbox}, which nobody reads: set an inbox someone reads as the reply-to address.`
  return null
}

/** A drawn letter with a picture other than its small logo. */
export function letterHtmlProblems(html: string, opts: { logo: boolean }) {
  const pictures = (html.match(/<img\b/gi) ?? []).length
  return pictures > (opts.logo ? 1 : 0)
    ? ['A text email has no pictures: only its small logo at the top.']
    : []
}
