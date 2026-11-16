/**
 * DST-PIC #27 ("Preview text that adds something"): the preview text pairs
 * with the subject and never repeats it. The inbox shows the two side by
 * side, so a preview that says the subject again wastes the line. Code
 * only, the same answer every time, for the Copywriter's drafts and the
 * Letter writer's letters (each told the rule and the reason).
 *
 * A preview repeats the subject when, read as words (capitals, punctuation
 * and a possessive aside):
 * - it is the subject;
 * - it holds the whole subject, or the subject holds the whole preview
 *   (when the part held has a word that says something);
 * - it has at least 3 of the subject's words that say something, and 3 of
 *   every 4 of them (a plural counts as its word).
 *
 * The brand's name is left out first: it is the sender, shown beside the
 * subject in every inbox, so naming it in both lines repeats nothing.
 * A product's title counts: when both lines name the product, the writer
 * is told to name it in one only.
 */

/** Words too common to say anything on their own. */
const plainWords = new Set([
  'a',
  'about',
  'all',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'has',
  'have',
  'here',
  'i',
  'in',
  'is',
  'it',
  'its',
  'just',
  'me',
  'my',
  'now',
  'of',
  'on',
  'or',
  'our',
  'so',
  'that',
  'the',
  'these',
  'this',
  'those',
  'to',
  'us',
  'was',
  'we',
  'what',
  'with',
  'you',
  'your'
])

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The words a reader sees, in order: lower case, a possessive dropped. */
const wordsOf = (text: string) =>
  (
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+(?:['’]\p{L}+)*/gu) ?? []
  ).map((w) => w.replace(/['’]s$/u, ''))

/** A word and its plural read as one ("candles" is "candle"). */
const stem = (word: string) =>
  word.length > 3 && /[^s]s$/u.test(word) ? word.slice(0, -1) : word

const says = (words: readonly string[]) => words.some((w) => !plainWords.has(w))

/** `part` as whole words inside `whole`. */
const holds = (whole: readonly string[], part: readonly string[]) =>
  ` ${whole.join(' ')} `.includes(` ${part.join(' ')} `)

/**
 * Why the preview repeats the subject, in plain words for the writer
 * (null: it adds something). `brand` is the sender's name.
 */
export function previewRepeat(
  subject: string,
  preview: string,
  brand = ''
): string | null {
  const plain = (a: string) => a.replace(/\s+/g, ' ').trim().toLowerCase()
  if (plain(subject) && plain(subject) === plain(preview))
    return 'The preview text repeats the subject: add something the subject does not say.'
  const sender = brand.trim()
  const strip = (text: string) =>
    sender.length >= 2
      ? text.replace(new RegExp(escape(sender), 'giu'), ' ')
      : text
  const s = wordsOf(strip(subject))
  const p = wordsOf(strip(preview))
  if (!s.length || !p.length) return null
  if (s.join(' ') === p.join(' '))
    return 'The preview text repeats the subject: add something the subject does not say.'
  if (says(s) && holds(p, s))
    return 'The preview text repeats the whole subject: leave the subject’s words out of it and say what the subject does not.'
  if (says(p) && holds(s, p))
    return 'The preview text only repeats part of the subject: say something the subject does not.'
  const key = (words: readonly string[]) =>
    new Set(words.filter((w) => !plainWords.has(w)).map(stem))
  const fromSubject = key(s)
  const inPreview = key(p)
  const shared = [...fromSubject].filter((w) => inPreview.has(w))
  if (shared.length >= 3 && shared.length * 4 >= fromSubject.size * 3)
    return `The preview text says the subject again (${shared.length} of its ${fromSubject.size} words): say what the subject leaves out, and name a product in one of them only.`
  return null
}
