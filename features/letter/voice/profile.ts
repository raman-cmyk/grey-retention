import type { VoiceSample } from './samples'

/**
 * PIC-23 part 3a (owner pick #23, the founder's voice): how the owner
 * writes, measured by code from the voice samples the history read kept
 * (PIC-23 part 2b: the owner's own words, already without people's names,
 * contact details, reviews and Klaviyo's tags). Only letters and emails in
 * custom code count (weight 2 or 3): a designed promotion is headlines and
 * buttons, not a voice.
 *
 * From them: the greeting the owner uses most ("Hi,"), the sign-off
 * ("Warmly,"), whether they write as "I" or "we", how long their
 * sentences are, how often they use "!" and contractions, and up to five
 * of their own sentences as examples (never one with a number or a
 * placeholder). No AI and no database: part 3b gives it to the Letter
 * writer.
 */
export type FounderVoice = {
  /** The greeting used most, without its placeholder ("Hi [first name]," is "Hi,"). */
  greeting: string | null
  /** The sign-off used most ("Warmly,"). */
  signoff: string | null
  /** "I" for a founder writing alone, "we" for a team, null when mixed or unknown. */
  writesAs: 'I' | 'we' | null
  /** Words in a sentence, on average. */
  sentenceWords: number
  exclamations: Frequency
  contractions: Frequency
  /** Up to `maxVoiceExamples` of the owner's own sentences, the letters' first. */
  examples: string[]
  /** What it was read from. */
  from: { samples: number; words: number }
}

export type Frequency = 'never' | 'sometimes' | 'often'

export const founderVoiceVersion = '2026-11-16.1'

/** Fewer of the owner's words than this say nothing about a voice. */
export const minVoiceWords = 40
export const maxVoiceExamples = 5
/** An example is a sentence of this many words. */
const exampleWords = { min: 6, max: 25 }
const maxExampleChars = 200
/** A greeting is the first line, of at most this many words, ending with a comma. */
const maxGreetingWords = 5
/** A sign-off is one of the last three lines, of at most this many words. */
const maxSignoffWords = 4
/** At most this many samples and characters are read. */
const maxSamples = 20
const maxChars = 60_000

const placeholder = /\[[a-z ]{2,20}\]/g
const hasPlaceholder = /\[[a-z ]{2,20}\]/
const sentenceEnd = /(?<=[.!?…।॥。؟])\s+|(?<=[।॥。؟])/u

/** The owner's words in a text: a placeholder is not one. */
const wordsIn = (text: string) =>
  text
    .replace(placeholder, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))

/** A greeting or a sign-off as the writer may use it: no placeholder. */
const shown = (line: string) =>
  line
    .replace(placeholder, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,!])/g, '$1')
    .trim()

/** A greeting or sign-off line: words and one comma (or "!") at its end. */
const closing = (line: string, max: number) => {
  const words = wordsIn(line)
  return (
    words.length >= 1 &&
    words.length <= max &&
    /[,!]$/.test(line) &&
    // Letters, spaces, an apostrophe or a hyphen only: never a number or a link mark.
    /^[\p{L}\p{M}\s'’-]+$/u.test(shown(line).slice(0, -1))
  )
}

/** One sample's greeting, sign-off and the lines between. */
function partsOf(text: string) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const greeting =
    lines[0] && closing(lines[0], maxGreetingWords) && lines[0].endsWith(',')
      ? shown(lines[0])
      : null
  const start = greeting ? 1 : 0
  let end = lines.length
  let signoff: string | null = null
  for (let k = lines.length - 1; k >= Math.max(start, lines.length - 3); k--)
    if (lines[k]!.endsWith(',') && closing(lines[k]!, maxSignoffWords)) {
      signoff = shown(lines[k]!)
      end = k
      break
    }
  return { greeting, signoff, body: lines.slice(start, end) }
}

const sentencesOf = (lines: readonly string[]) =>
  lines
    .flatMap((line) => line.split(sentenceEnd))
    .map((s) => s.trim())
    .filter((s) => wordsIn(s).length > 0)

/** The one used most, the first seen on a tie (the letters come first). */
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
  return best?.shown ?? null
}

const frequency = (rate: number): Frequency =>
  rate === 0 ? 'never' : rate >= 0.25 ? 'often' : 'sometimes'

const iForm = /^i(?:['’](?:m|ve|ll|d))?$/
const weForm = /^we(?:['’](?:re|ve|ll|d))?$/
const contraction =
  /\p{L}['’](?:re|ve|ll|d|m|t)\b|\b(?:it|that|here|there|what|who|let|he|she)['’]s\b/iu

/** How the owner writes, or null when their letters say too little. */
export function founderVoice(
  samples: readonly VoiceSample[]
): FounderVoice | null {
  let chars = 0
  const read = samples
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
    .slice(0, maxSamples)
    .filter((s) => (chars += s.text.length) <= maxChars)
  const parts = read.map((s) => partsOf(s.text))
  const sentences = parts.flatMap((p) => sentencesOf(p.body))
  const words = sentences.reduce((n, s) => n + wordsIn(s).length, 0)
  if (!sentences.length || words < minVoiceWords) return null

  let i = 0
  let we = 0
  for (const s of sentences)
    for (const w of wordsIn(s)) {
      const t = w.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}'’]+$/gu, '')
      if (iForm.test(t)) i++
      else if (weForm.test(t)) we++
    }
  const writesAs =
    i + we < 2
      ? null
      : i / (i + we) >= 0.7
        ? 'I'
        : we / (i + we) >= 0.7
          ? 'we'
          : null

  const examples: string[] = []
  const taken = new Set<string>()
  for (const s of sentences) {
    if (examples.length >= maxVoiceExamples) break
    const n = wordsIn(s).length
    if (n < exampleWords.min || n > exampleWords.max) continue
    if (
      s.length > maxExampleChars ||
      hasPlaceholder.test(s) ||
      /\p{N}/u.test(s)
    )
      continue
    const key = s.toLowerCase()
    if (taken.has(key)) continue
    taken.add(key)
    examples.push(s)
  }

  return {
    greeting: most(parts.map((p) => p.greeting)),
    signoff: most(parts.map((p) => p.signoff)),
    writesAs,
    sentenceWords: Math.round(words / sentences.length),
    exclamations: frequency(
      sentences.filter((s) => s.endsWith('!')).length / sentences.length
    ),
    contractions: frequency(
      sentences.filter((s) => contraction.test(s)).length / sentences.length
    ),
    examples,
    from: { samples: read.length, words }
  }
}
