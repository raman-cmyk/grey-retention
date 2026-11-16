import { hiddenChars } from '@/features/assembly/assemble'

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
 * The brand's name is left out first, as words: it is the sender, shown
 * beside the subject in every inbox, so naming it in both lines repeats
 * nothing. Both lines and the name are read as the email builders write
 * them (`oneLine`: any run of spaces as one, hidden characters dropped,
 * the name cut at its limit, its last word maybe cut too), so the plain
 * copy's fixed lines pass for every name a store can have. A product's
 * title counts: when both lines name the product, the writer is told to
 * name it in one only.
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

const hidden = new RegExp(hiddenChars.source, 'gu')

/**
 * The words a reader sees, in order: lower case, hidden characters out,
 * one apostrophe, a possessive dropped; a word keeps its marks (an accent
 * written apart, Devanagari's vowel signs).
 */
const wordsOf = (text: string) =>
  (
    text
      .normalize('NFKC')
      // As `oneLine`: spaces (a tab too) first, then hidden characters.
      .replace(/\s+/g, ' ')
      .replace(hidden, '')
      .replace(/’/g, "'")
      .toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:'[\p{L}\p{M}]+)*/gu) ?? []
  ).map((w) => w.replace(/'s$/u, ''))

/**
 * `words` without the brand's name: the whole name anywhere, and a name
 * cut short (at least its first two words, its next word maybe cut too)
 * only where the builders cut it, at the end of the line.
 */
function withoutBrand(words: readonly string[], brand: readonly string[]) {
  if (!brand.length) return [...words]
  const out: string[] = []
  for (let i = 0; i < words.length;) {
    let k = 0
    while (k < brand.length && words[i + k] === brand[k]) k++
    const next = words[i + k]
    const cut = next !== undefined && brand[k]?.startsWith(next) ? 1 : 0
    if (k === brand.length || (k >= 2 && i + k + cut === words.length)) {
      i += k === brand.length ? k : k + cut
      continue
    }
    out.push(words[i]!)
    i++
  }
  return out
}

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
  const same =
    'The preview text repeats the subject: add something the subject does not say.'
  const plain = (a: string) => a.replace(/\s+/g, ' ').trim().toLowerCase()
  if (plain(subject) && plain(subject) === plain(preview)) return same
  // The same words, the brand's included (a subject that is only the name).
  const all = { s: wordsOf(subject), p: wordsOf(preview) }
  if (all.s.length && all.s.join(' ') === all.p.join(' ')) return same
  const sender = wordsOf(brand)
  const s = withoutBrand(all.s, sender)
  const p = withoutBrand(all.p, sender)
  if (!s.length || !p.length) return null
  if (s.join(' ') === p.join(' ')) return same
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
