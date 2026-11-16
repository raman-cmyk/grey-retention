import {
  phrase,
  previewRange,
  spamPhrases,
  subjectMax
} from '@/features/email-build/inspect'
import {
  letterText,
  letterWords,
  linksIn,
  maxLetterLinks,
  seenText,
  wordCount,
  type Letter
} from './letter'

/**
 * TXT-001, the text checks (AGENT_MAP §4: length, at most 2 links, no
 * images, spam words, a real reply-to inbox). Code only, the same answer
 * every time. The letter's own problems go back to the Letter writer with
 * the exact reason, as a designed email's go to the Copywriter (D21); the
 * reply-to inbox is the owner's setting, so it is the owner's to fix.
 */
export type LetterProblem = { rule: string; reason: string }

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`
const quoted = (list: readonly string[]) =>
  list.map((w) => `“${w}”`).join(list.length === 2 ? ' and ' : ', ')
/** A web or email address, as a reader would see it. */
const address =
  /\bhttps?:\/\/|\bwww\.|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b|\b[a-z0-9-]+\.(?:com|net|org|shop|store|co|io|uk|au)\b/i

/** What is wrong with a letter, in plain words (empty: nothing). */
export function letterProblems(letter: Letter): LetterProblem[] {
  const problems: LetterProblem[] = []
  const add = (rule: string, reason: string) => problems.push({ rule, reason })
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
        ? `${quoted(missing.map((u) => u.words))} ${missing.length === 1 ? 'points' : 'point'} to a link that does not exist: use ${letter.links.map((_, i) => `(${i + 1})`).join(' or ')}.`
        : `There is no link to point to: write ${quoted(missing.map((u) => u.words))} without one.`
    )
  // Everything a reader sees, the inbox lines too.
  const seen = [
    letter.subject,
    letter.preheader,
    letter.greeting ?? '',
    ...read,
    letter.signoff,
    letter.signature,
    letter.role ?? ''
  ].map(seenText)
  if (seen.some((t) => address.test(t)))
    add(
      'address_in_text',
      'Write no web or email address: put a link on a few words, as [the words](1).'
    )
  if (seen.some((t) => /[{}]/.test(t)))
    add('template_marks', 'Write no { or }: Klaviyo reads them as its own.')
  const spam = spamPhrases.filter((p) => seen.some((t) => phrase(t, p)))
  if (spam.length)
    add(
      'spam_words',
      `Leave out ${quoted(spam.slice(0, 3))}: ${spam.length === 1 ? 'it reads' : 'they read'} as spam.`
    )
  const subject = [...letter.subject].length
  if (subject > subjectMax)
    add(
      'subject_too_long',
      `The subject is ${subject} characters; at most ${subjectMax}.`
    )
  const preview = [...letter.preheader].length
  if (preview < previewRange.min || preview > previewRange.max)
    add(
      'preview_length',
      `The preview line is ${count(preview, 'character')}; write ${previewRange.min} to ${previewRange.max}.`
    )
  return problems
}

/** Inboxes nobody reads. */
const unread =
  /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|bounces?|mailer[-_.]?daemon|postmaster)(?:[-_.+]|$)/i

/**
 * A text email asks for a reply, so its replies must reach a person: the
 * owner's reply-to inbox, or the reason it is not one (null: it is).
 */
export function replyToProblem(replyTo: string | null | undefined) {
  const inbox = replyTo?.trim() ?? ''
  if (!inbox)
    return 'Set an inbox someone reads as the reply-to address: a text email asks people to reply.'
  const at = inbox.lastIndexOf('@')
  if (at < 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inbox))
    return `“${inbox.slice(0, 80)}” is not an email address: set an inbox someone reads as the reply-to address.`
  if (unread.test(inbox.slice(0, at)))
    return `Replies go to ${inbox.slice(0, 80)}, which nobody reads: set an inbox someone reads as the reply-to address.`
  return null
}

/** A drawn letter with a picture other than its small logo. */
export function letterHtmlProblems(html: string, opts: { logo: boolean }) {
  const pictures = (html.match(/<img\b/gi) ?? []).length
  return pictures > (opts.logo ? 1 : 0)
    ? ['A text email has no pictures: only its small logo at the top.']
    : []
}
