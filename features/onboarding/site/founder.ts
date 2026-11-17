import { fold } from './pages'

/**
 * REL-ONB2 part d: the founder's own note on the store's About page, only
 * when it is provably the page's own words. "Create email" may place a
 * founder's note only word for word from the store's own pages (the
 * owner's rule of 16 November: nothing invented), so the Site reader keeps
 * a founder finding only when code proves, on the page itself:
 *
 * - the quote is whole sentences of the page (`wholeSentences`): it starts
 *   where a sentence or a block of the page starts and ends with the
 *   sentence's own closing mark, every line break inside it after one;
 *   whitespace is folded, but the letters are the page's (never the
 *   model's capitals or quote marks);
 * - it is written in the first person singular (`firstPerson`: an "I", a
 *   "my" or a "me"), never a sentence about the founder ("Jane founded the
 *   brand", "She knits", "Jane's mother…");
 * - the founder's name is on the page word for word (`onPage`).
 *
 * Over-blocking is the safer mistake: a note it refuses is no founder's
 * note in an email, never someone else's words under their name.
 */

/** The page's blocks (headings, paragraphs), each on its own line. */
const blocks = (text: string) =>
  text.split('\n').map(fold).filter(Boolean).join('\n')

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

/** Marks around a sentence: before it ("“I…") and after its stop ("…wool.”"). */
const openers = /["'“‘(«]*$/u
const closers = /^["'”’»)\]]*/u
const stop = /[.!?…]["'”’»)\]]*$/u
/** A stop after an initial or an abbreviation ends no sentence ("J. Smith", "Dr. Lee"). */
const initial = /(?:^|[^\p{L}\p{N}])\p{Lu}\.["'”’»)\]]*$/u
const abbreviation =
  /(?:^|[^\p{L}\p{N}])(?:mr|mrs|ms|mx|dr|prof|st|sr|jr|vs|inc|ltd|approx|e\.g|i\.e)\.["'”’»)\]]*$/iu

/** Whether a text ends a sentence: its stop, never an abbreviation's. */
const endsSentence = (text: string) => {
  const t = text.trimEnd()
  return stop.test(t) && !initial.test(t) && !abbreviation.test(t)
}

/** A sentence starts with a capital or a number, after its opening marks. */
const capital = /^["'“‘(«]*[\p{Lu}\p{N}]/u

/**
 * The quote as the page writes it, when it is whole sentences of the
 * page: whitespace folded (a line break as a space), every letter and mark
 * the page's own, with the page's quote marks around it. Null when the
 * page does not hold it, or holds it only as part of a sentence.
 */
export function wholeSentences(text: string, quote: string): string | null {
  const page = blocks(text)
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
      (after === '' || /^\s/.test(after)) &&
      // A block inside it ends a sentence too (never a heading run on).
      found
        .split('\n')
        .slice(0, -1)
        .every((line) => endsSentence(line))
    )
      return fold(found)
  }
  return null
}

const notLetter = String.raw`[^\p{L}\p{N}'’]`
const firstPersonWord = new RegExp(
  String.raw`(?:^|${notLetter})(?:I(?:['’](?:m|ve|d|ll))?|[Mm]y|[Mm]e|[Mm]ine|[Mm]yself)(?=$|${notLetter})`,
  'u'
)
/** "She" and "he": someone written about, never the writer. */
const thirdPerson = new RegExp(
  String.raw`(?:^|${notLetter})(?:she|he)(?=$|${notLetter})`,
  'iu'
)
const title = /^(?:dr|mr|mrs|ms|miss|mx|prof|sir|dame)\.?$/i

/**
 * Whether a note is the founder's own, in the first person singular: an
 * "I", "my" or "me", never "she" or "he", and never the founder's name
 * doing something or owning something ("Jane founded", "Jane is", "Jane's
 * mother"): a sentence about them, not by them.
 */
export function firstPerson(quote: string, name: string): boolean {
  if (!firstPersonWord.test(quote) || thirdPerson.test(quote)) return false
  return !name
    .split(/\s+/)
    .map((w) => w.replace(/[.,]$/, ''))
    .filter((w) => Array.from(w).length >= 2 && !title.test(w))
    .some((w) =>
      new RegExp(
        String.raw`(?:^|[^\p{L}\p{N}])${escape(w)}(?:['’]s|\s+\p{Ll}+(?:s|ed))(?=$|[^\p{L}\p{N}])`,
        'u'
      ).test(quote)
    )
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
