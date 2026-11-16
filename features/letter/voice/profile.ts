import { offerWords } from '@/features/onboarding/history/facts'
import type { VoiceSample } from './samples'

/**
 * PIC-23 part 3a (owner pick #23, the founder's voice): how the owner
 * writes, measured by code from the voice samples the history read kept
 * (PIC-23 part 2b: the owner's own words, already without people's full
 * names, contact details, reviews and Klaviyo's tags). Only letters and
 * emails in custom code count (weight 2 or 3): a designed promotion is
 * headlines and buttons, not a voice.
 *
 * From them: the greeting and the sign-off the owner uses (in at least half
 * of the emails read), whether they write as "I" or "we" and how often
 * they use contractions (English only), how long their sentences are and
 * how often they end with "!", and up to five of their own sentences as
 * examples. An example is the last gate before an AI reads the words, so it
 * is strict: a whole sentence (a capital letter where the script has one,
 * a full stop, "!" or "?" at its end), never a number, a placeholder, a
 * quote, a link or an address, an offer or a code, or a capitalised word
 * that is not "I" or one of the store's own words (a person's or another
 * shop's name). No AI and no database: part 3b gives it to the Letter
 * writer.
 */
export type FounderVoice = {
  /** The greeting used most, without its placeholder ("Hi [first name]," is "Hi,"). */
  greeting: string | null
  /** The sign-off used most ("Warmly,"). */
  signoff: string | null
  /** "I" for a founder writing alone, "we" for a team; null when mixed, unknown or not English. */
  writesAs: 'I' | 'we' | null
  /** Words in a sentence, on average. */
  sentenceWords: number
  /** How often a sentence ends with "!". */
  exclamations: Frequency
  /** How often a sentence has a contraction ("we're"); null when not English. */
  contractions: Frequency | null
  /** Up to `maxVoiceExamples` of the owner's own sentences, the letters' first. */
  examples: string[]
  /** What it was read from. */
  from: { samples: number; words: number }
}

export type Frequency = 'never' | 'sometimes' | 'often'

export const founderVoiceVersion = '2026-11-16.3'

/** Fewer of the owner's words than this say nothing about a voice. */
export const minVoiceWords = 40
export const maxVoiceExamples = 5
/** An example is a sentence of this many words, at most `maxExampleChars`. */
export const exampleWords = { min: 6, max: 25 } as const
export const maxExampleChars = 200
/** A greeting is the first line, of at most this many words, ending with a comma or "!". */
const maxGreetingWords = 5
/** A sign-off is one of the last three lines, of at most this many words. */
const maxSignoffWords = 4
/** A greeting or sign-off line is short: a longer line is never read as one. */
const maxClosingChars = 80
/** At most this many samples and characters are read. */
export const maxVoiceSamplesRead = 20
export const maxVoiceCharsRead = 60_000
/** A word longer than this is never an "I" or "we" (and is never trimmed by pattern). */
const maxTokenChars = 40
/** At most this many of the store's own phrases, of this many words each. */
const maxOwn = 5_000
const maxOwnWords = 12

const placeholder = /\[[a-z ]{2,20}\]/g
const hasPlaceholder = /\[[a-z ]{2,20}\]/
const sentenceEnd = /(?<=[.!?…。！？؟۔।॥])\s+|(?<=[。！？؟۔।॥])/u
/** A sentence's end: a stop, then perhaps closing quotes or brackets. */
const endsSentence = /[.!?…。！？؟۔।॥]["'”’)\]]{0,3}$/u
const closingMark = /[,،，!！]$/u
const exclaims = /[!！]["'”’)\]]{0,3}$/u

/** The owner's words in a text: a placeholder is not one. */
const wordsIn = (text: string) =>
  text
    .replace(placeholder, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))

/**
 * A word without what is around it ("(we’re," is "we’re"), by a loop from
 * each end: a pattern anchored at the end tries every start (slow on a
 * long run of marks). A long word is none.
 */
function bare(word: string) {
  if (word.length > maxTokenChars) return ''
  const letter = (c: string) => /\p{L}/u.test(c)
  const chars = [...word]
  let a = 0
  let b = chars.length
  while (a < b && !letter(chars[a]!)) a++
  while (b > a && !letter(chars[b - 1]!)) b--
  return chars.slice(a, b).join('')
}

/**
 * A greeting or sign-off as the writer may use it, or null: a few words of
 * letters and a comma or "!" at its end, a placeholder only just before
 * that mark ("Hi [first name]," is "Hi,"; "Hello [first name] and
 * [last name]," is none).
 */
function closingOf(line: string, max: number): string | null {
  if (line.length > maxClosingChars || !closingMark.test(line)) return null
  const mark = line.slice(-1)
  let head = line.slice(0, -1).trimEnd()
  const tag = head.lastIndexOf('[')
  if (tag >= 0 && /^\[[a-z ]{2,20}\]$/.test(head.slice(tag)))
    head = head.slice(0, tag).trimEnd()
  if (hasPlaceholder.test(head) || !/^[\p{L}\p{M}\s'’-]+$/u.test(head))
    return null
  // A dash or an apostrophe alone ("Hi -") is no word.
  if (/(?:^|\s)[-'’]|[-'’](?:\s|$)/u.test(head)) return null
  const words = head.split(/\s+/).filter(Boolean)
  if (!words.length || words.length > max) return null
  return `${words.join(' ')}${mark}`
}

/**
 * Lines wrapped inside a sentence ("…with one old" / "sewing machine…")
 * become one: a line that ends with no stop, followed by one starting
 * with a lower-case letter. The first line (the greeting) is never joined.
 */
function unwrapped(lines: readonly string[]) {
  const out: string[][] = []
  for (const line of lines) {
    const last = out.at(-1)
    const tail = last?.at(-1)
    if (
      last &&
      tail !== undefined &&
      out.length > 1 &&
      !endsSentence.test(tail.slice(-8)) &&
      !closingMark.test(tail) &&
      /^\p{Ll}/u.test(line) &&
      // "warmly," of a writer in lower case is a sign-off, not a wrap.
      !closingOf(line, maxSignoffWords)
    )
      last.push(line)
    else out.push([line])
  }
  return out.map((parts) => parts.join(' '))
}

/** One sample's greeting, sign-off and the lines between. */
function partsOf(text: string) {
  const lines = unwrapped(
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  )
  const greeting = lines[0] ? closingOf(lines[0], maxGreetingWords) : null
  const start = greeting ? 1 : 0
  let end = lines.length
  let signoff: string | null = null
  for (let k = lines.length - 1; k >= Math.max(start, lines.length - 3); k--) {
    const found = closingOf(lines[k]!, maxSignoffWords)
    if (found) {
      signoff = found
      end = k
      break
    }
  }
  return { greeting, signoff, body: lines.slice(start, end) }
}

/** Whole sentences only: a heading, a button or a fragment is none. */
const sentencesOf = (lines: readonly string[]) =>
  lines
    .flatMap((line) => line.split(sentenceEnd))
    .map((s) => s.trim())
    .filter((s) => endsSentence.test(s.slice(-8)) && wordsIn(s).length > 0)

/**
 * The one used most, when the emails read use it at least half the time
 * (one stray line never decides); the first seen on a tie.
 */
function most(seen: readonly (string | null)[]) {
  const counts = new Map<string, { shown: string; n: number }>()
  for (const s of seen) {
    if (!s) continue
    const key = s.toLowerCase()
    const c = counts.get(key)
    if (c) c.n++
    else counts.set(key, { shown: s, n: 1 })
  }
  let best: { shown: string; n: number } | null = null
  for (const c of counts.values()) if (!best || c.n > best.n) best = c
  return best && best.n * 2 >= seen.length ? best.shown : null
}

const frequency = (rate: number): Frequency =>
  rate === 0 ? 'never' : rate >= 0.25 ? 'often' : 'sometimes'

const iForm = /^I(?:['’](?:m|ve|ll|d))?$/
const lowerIForm = /^i(?:['’](?:m|ve|ll|d))?$/
const weForm = /^we(?:['’](?:re|ve|ll|d))?$/i
const contraction =
  /\p{L}['’](?:re|ve|ll|d|m|t)\b|\b(?:it|that|here|there|what|who|let|he|she)['’]s\b/iu
/**
 * Common English words that are no common word of the other languages
 * stores write in ("a", "i" and "in" are Italian and Catalan too; "we",
 * "is", "was" and "of" Dutch): a sample with enough of them is read as
 * English.
 */
const english = new Set(
  'the and to for with are it you your our my this that but be have just from'.split(
    ' '
  )
)
const englishShare = 0.12
/**
 * The only capitalised words an example may start with: ordinary first
 * words, never one that is also a name ("Will", "May", "Hope").
 */
const starters = new Set(
  'i we our my the a an this that these those it its every each if when thank thanks you your there here what how why so and but just all some one after before since now as for in on at with to please come take they he she us while once most many more even also then still not no yes maybe sometimes honestly really everything everyone nothing both either few much because although though until whenever where who which'.split(
    ' '
  )
)
/**
 * The words a greeting or sign-off may start with, in the languages stores
 * write in (never a name: "Maya here!" is none).
 */
const closers = new Set(
  'hi hello hey heya hiya howdy dear greetings good morning evening warmly warm warmest best cheers love lots thanks thank talk see speak until till take with yours sincerely kind kindest regards all xo xx bye happy bonjour salut coucou chers chère cher chères à a bisous amitiés cordialement merci hola buenos buenas querido querida queridos queridas saludos besos abrazos gracias un una ciao buongiorno salve cari care caro cara grazie hallo hoi liebe lieber liebes viele herzliche grüße bis tschüss danke olá oi obrigado obrigada abraços beijos até'.split(
    ' '
  )
)

/** Talk of an offer, a code or a deadline, in words: never an example. */
const offerTalk =
  /\b(?:codes?|coupons?|promo|discount(?:s|ed)?|half|price[sd]?|free|sale|off|deals?|save|savings?|percent|per cent|cheap(?:er|est)?|less|lower|mark(?:ed)? down|markdowns?|clearance|clearing|reduced|bargains?|on us|no (?:extra )?cost|complimentary|gifts?|two for one|bogo|last chance|ends? (?:tonight|today|tomorrow|soon)|(?:today|tonight) only|while (?:they|stocks?|supplies) lasts?|before (?:it['’]?s|they['’]?re|they) go(?:ne)?|limited|sold out|selling (?:out|fast)|few left|stock)\b/i
/** A link, an address or a handle: never an example. */
const linkLike = /\p{L}\.\p{L}|[/@#]|\bwww\b|https?/iu
/**
 * A quote, in any form: someone else's words ("‘" anywhere, an apostrophe
 * after anything but a letter).
 */
const quoted = /["“”„«»‹›「」『』‘]|(?:^|[^\p{L}])['’]/u

/** A run of the store's words is at most this many words. */
const maxOwnRun = 4

/**
 * The store's own words (its name, its product titles), lower case: each
 * run of two to four words of a title ("cedar goods", "emma dress") and a
 * title of one word, never one word of a longer title ("Emma" of "The Emma
 * Dress" is a person's name as often as the dress).
 */
function ownSet(own: readonly unknown[]) {
  const set = new Set<string>()
  if (!Array.isArray(own)) return set
  for (const phrase of own.slice(0, maxOwn)) {
    if (typeof phrase !== 'string') continue
    const words = phrase
      .split(/\s+/)
      .slice(0, maxOwnWords)
      .map((w) => bare(w).toLowerCase())
      .filter(Boolean)
    if (words.length === 1) set.add(words[0]!)
    for (let a = 0; a < words.length; a++)
      for (let n = 2; n <= maxOwnRun && a + n <= words.length; n++)
        set.add(words.slice(a, a + n).join(' '))
  }
  return set
}

/** Whether the word at `k` is part of a run of the store's own words. */
function inOwnRun(
  bares: readonly string[],
  k: number,
  ours: ReadonlySet<string>
) {
  if (ours.has(bares[k]!)) return true
  for (let n = 2; n <= maxOwnRun; n++)
    for (let a = Math.max(0, k - n + 1); a <= k && a + n <= bares.length; a++)
      if (ours.has(bares.slice(a, a + n).join(' '))) return true
  return false
}

/** How the owner writes, or null when their letters and coded emails say too little. */
export function founderVoice(
  samples: readonly VoiceSample[],
  /** The store's own words (its name, its product titles): an example may name them. */
  own: readonly string[] = []
): FounderVoice | null {
  if (!Array.isArray(samples)) return null
  const usable = samples
    .filter(
      (s): s is VoiceSample =>
        typeof s === 'object' &&
        s !== null &&
        typeof s.text === 'string' &&
        (s.weight === 2 || s.weight === 3)
    )
    // The letters first, then the order the samples were kept in.
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.weight - a.s.weight || a.i - b.i)
    .map(({ s }) => s)
  // A sample that would go past the total is passed over for a shorter one.
  const read: VoiceSample[] = []
  let chars = 0
  for (const s of usable) {
    if (read.length >= maxVoiceSamplesRead) break
    if (chars + s.text.length > maxVoiceCharsRead) continue
    chars += s.text.length
    read.push(s)
  }
  const parts = read.map((s) => ({
    ...partsOf(s.text),
    text: s.text,
    letter: s.weight === 3
  }))
  // The letters decide the greeting and sign-off when there are any.
  const closers = parts.some((p) => p.letter)
    ? parts.filter((p) => p.letter)
    : parts
  const sentences = parts.flatMap((p) => sentencesOf(p.body))
  const words = sentences.reduce((n, s) => n + wordsIn(s).length, 0)
  if (!sentences.length || words < minVoiceWords) return null

  // "I", "we" and contractions only where the samples read as English.
  let i = 0
  let we = 0
  let common = 0
  let all = 0
  let contracted = 0
  let englishSentences = 0
  for (const p of parts) {
    const lowerStyle = !/\p{Lu}/u.test(p.text)
    const said = sentencesOf(p.body)
    const tokens = said.flatMap((s) => wordsIn(s).map(bare)).filter(Boolean)
    const shared = tokens.filter((t) => english.has(t.toLowerCase())).length
    if (!tokens.length || shared / tokens.length < englishShare) continue
    common += shared
    all += tokens.length
    englishSentences += said.length
    contracted += said.filter((s) => contraction.test(s)).length
    for (const t of tokens) {
      if (iForm.test(t) || (lowerStyle && lowerIForm.test(t))) i++
      else if (weForm.test(t)) we++
    }
  }
  const isEnglish = all > 0 && common / all >= englishShare
  const writesAs =
    !isEnglish || i + we < 2
      ? null
      : i / (i + we) >= 0.7
        ? 'I'
        : we / (i + we) >= 0.7
          ? 'we'
          : null

  const ours = ownSet(own)
  // A greeting or sign-off is shown to an AI as the founder's: the same
  // word checks as an example (never an offer, a deadline or a name).
  const safe = (line: string | null) =>
    line && safeClosing(line, ours) ? line : null
  const examples: string[] = []
  const taken = new Set<string>()
  for (const s of sentences) {
    if (examples.length >= maxVoiceExamples) break
    if (!safeExample(s, ours)) continue
    const key = s.toLowerCase().replace(/[.!?…。！？؟۔।॥"'”’)\]]+$/u, '')
    if (taken.has(key)) continue
    taken.add(key)
    examples.push(s)
  }

  return {
    greeting: safe(most(closers.map((p) => p.greeting))),
    signoff: safe(most(closers.map((p) => p.signoff))),
    writesAs,
    sentenceWords: Math.round(words / sentences.length),
    exclamations: frequency(
      sentences.filter((s) => exclaims.test(s.slice(-8))).length /
        sentences.length
    ),
    contractions:
      isEnglish && englishSentences
        ? frequency(contracted / englishSentences)
        : null,
    examples,
    from: { samples: read.length, words }
  }
}

/**
 * Whether a greeting or sign-off is safe to show an AI as the founder's:
 * no offer, deadline or code in words, a first word a greeting or sign-off
 * starts with (`closers`, `starters`), and no other capitalised word but
 * the store's own ("Hi Sarah," and "Love Maya," are none).
 */
function safeClosing(line: string, ours: ReadonlySet<string>) {
  if (offerTalk.test(line) || offerWords.test(line)) return false
  const words = wordsIn(line.slice(0, -1))
  const bares = words.map((w) => bare(w).toLowerCase())
  return words.every((w, k) => {
    const b = bare(w)
    if (!b) return false
    if (k === 0) return closers.has(bares[0]!) || starters.has(bares[0]!)
    return b[0] === b[0]!.toLowerCase() || inOwnRun(bares, k, ours)
  })
}

/**
 * Whether a sentence is safe to show an AI as the owner's voice (see
 * above): a capitalised word is "I", one of the store's own words, or an
 * ordinary first word (`starters`), so "Every" may start a sentence and
 * "Sarah" or "Will" may not.
 */
function safeExample(s: string, ours: ReadonlySet<string>) {
  const words = wordsIn(s)
  if (words.length < exampleWords.min || words.length > exampleWords.max)
    return false
  if (s.length > maxExampleChars || hasPlaceholder.test(s)) return false
  if (/\p{N}/u.test(s) || quoted.test(s) || linkLike.test(s)) return false
  if (offerTalk.test(s) || offerWords.test(s)) return false
  // A whole sentence: a capital first letter where the script has one.
  const first = [...s].find((c) => /\p{L}/u.test(c))
  if (first && first !== first.toUpperCase()) return false
  const bares = words.map((w) => bare(w).toLowerCase())
  return words.every((w, k) => {
    const b = bare(w)
    if (!b) return w.length <= maxTokenChars
    if (b[0] === b[0]!.toLowerCase()) return true
    if (iForm.test(b) || inOwnRun(bares, k, ours)) return true
    // A capitalised word: only a common first word, never a name.
    const lower = b.toLowerCase()
    return k === 0 && starters.has(lower)
  })
}
