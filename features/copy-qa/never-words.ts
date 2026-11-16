/**
 * PIC-29 part 1 (owner pick #29, "Words this brand never uses"): the words
 * the owner takes out of GROS's emails, learned from his edits. An email
 * GROS drafted is compared with the email that went out: its subject with
 * the sent subject, its preview line with the sent one, and each other
 * sentence with the sent sentence most like it (an unchanged sentence
 * first, then the closest pairs). Within a pair that changed, word by word,
 * a few words he took out (or swapped for others) are one removal
 * (`removedPhrases`), and only when they are gone from the whole email he
 * sent: a word moved, a sentence split, a comma made a full stop or a word
 * said once instead of twice is no removal. A sentence rewritten whole or
 * dropped says nothing about a word.
 *
 * Across emails (`learnNeverWords`), a phrase the owner took out of two
 * emails or more (a single word: three, and at least four letters), and
 * took out more often than he left it in when GROS wrote it, is one this
 * brand never uses; the rest are watched. Never learned: numbers (a
 * price, a date), the store's own words (its name, its products),
 * placeholders, words that carry no meaning alone ("the", "not", "it's",
 * "will") and a shop's everyday words ("new", "shop", "sale"), and a word
 * swapped for another form of itself ("candles" for "candle", "made" for
 * "make").
 *
 * Plain code, no AI and no database: part 2 keeps every sent GROS email's
 * two texts (changed or not, so a word left in counts) and gives the
 * never-used phrases to the writers and the copy checks; part 3 reads the
 * email that went out from Klaviyo.
 */

/** One email GROS drafted and the same email as it went out. */
export type OwnerEdit = {
  /** GROS's own id for the email, one per email (never a variation's). */
  messageId: string
  /**
   * GROS's lines as a reader sees them, Klaviyo's tags as placeholders:
   * the subject first, then the preview line, then the lines of text.
   */
  drafted: readonly string[]
  /** The same, as the owner sent it. */
  sent: readonly string[]
}

export type NeverWord = {
  phrase: string
  /** The emails he took it out of. */
  removed: number
  /** The emails where GROS wrote it and he left it in. */
  kept: number
  /** What he wrote in its place, when he swapped it (the latest few). */
  instead: string[]
}

export type NeverWords = {
  /** Taken out often enough, and more often than left in: refused from now on. */
  never: NeverWord[]
  /** Taken out too few times, or as often left in: watched, not refused. */
  watched: NeverWord[]
}

/** Two removals make a phrase one the brand never uses; three a single word. */
export const minRemovals = 2
export const minWordRemovals = 3
/** A single word needs at least this many letters to be learned. */
const minWordLetters = 4
/** A removal is at most this many words, swapped for at most as many. */
const maxSpan = 4
/** Body sentences are the same sentence when they share this share of the shorter's words. */
const sameSentence = 0.5
/** A subject or a preview line is the same when they share this share. */
const sameLine = 0.3
/** More changes than this in one sentence is a rewrite. */
const maxChanges = 3
/** Sentences longer than this are not compared word by word. */
const maxSentenceWords = 80
/** At most this many lines, sentences and words of an email are read. */
const maxLines = 400
const maxSentences = 300
const maxWords = 5_000
/** At most this many phrases come out (copy QA's list is 200 in all). */
export const maxNeverWords = 100

/** Light words trimmed from a phrase's ends ("the", "on", "is"). */
const edges = new Set(
  'a an the and or but so of to in on at by for with from as is are was were be been being am it its this that these those our your my we you i us they them he she his her their there here very just really also then now'.split(
    ' '
  )
)
/**
 * Words never learned alone: the light ones, negations, contractions,
 * auxiliaries, and a shop's everyday words ("new", "shop", "sale").
 */
const alone = new Set([
  ...edges,
  ..."not no nor don't doesn't didn't isn't aren't wasn't won't can't couldn't shouldn't wouldn't it's you're we're they're i'm i've i'll we'll you'll that's there's let's will would can could should shall may might must do does did done have has had get got make made new shop sale free off more most all any every each some one two out up".split(
    ' '
  )
])

/** NFKC, lower case, one apostrophe: as copy QA must read text too (part 2). */
const norm = (text: string) =>
  text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'")
/** A line's words: letters (with their marks), digits, apostrophes and hyphens inside a word. */
const wordsOf = (text: string) =>
  norm(text)
    // A placeholder ("[first name]") is no word of the owner's.
    .replace(/\[[^\]]{1,40}\]/g, ' ')
    .match(/[\p{L}\p{M}\p{N}]+(?:['-][\p{L}\p{M}\p{N}]+)*/gu) ?? []

type Sentence = { words: string[]; set: Set<string>; text: string }

/** A text's sentences (a line is at least one), each with its word set. */
function sentencesOf(lines: readonly string[]) {
  const out: Sentence[] = []
  let total = 0
  for (const line of lines.slice(0, maxLines)) {
    if (typeof line !== 'string') continue
    for (const part of line.split(/(?<=[.!?])\s+/)) {
      const words = wordsOf(part)
      if (!words.length) continue
      total += words.length
      if (total > maxWords || out.length >= maxSentences) return out
      out.push({ words, set: new Set(words), text: words.join(' ') })
    }
  }
  return out
}

/** Every run of one to four words of a text, for "is it still there". */
function groupsOf(words: readonly string[]) {
  const groups = new Set<string>()
  for (let i = 0; i < words.length; i++)
    for (let n = 1; n <= maxSpan && i + n <= words.length; n++)
      groups.add(words.slice(i, i + n).join(' '))
  return groups
}

/** How alike two sentences are: their shared words over the shorter's. */
function likeness(a: Sentence, b: Sentence) {
  let shared = 0
  for (const w of a.set) if (b.set.has(w)) shared++
  const shorter = Math.min(a.set.size, b.set.size)
  return shorter ? shared / shorter : 0
}

/** The spans one sentence changed into the other, word by word (LCS). */
function changes(a: readonly string[], b: readonly string[]) {
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const spans: {
    removed: string[]
    added: string[]
    atStart: boolean
    atEnd: boolean
  }[] = []
  let i = 0
  let j = 0
  let open: (typeof spans)[number] | null = null
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      open = null
      i++
      j++
      continue
    }
    if (!open) {
      open = {
        removed: [],
        added: [],
        atStart: i === 0 && j === 0,
        atEnd: false
      }
      spans.push(open)
    }
    if (j >= m || (i < n && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      open.removed.push(a[i]!)
      i++
    } else {
      open.added.push(b[j]!)
      j++
    }
    if (i >= n && j >= m) open.atEnd = true
  }
  return spans
}

/**
 * Whether two words are forms of one word ("candle", "candles"; "make",
 * "made"): one starts the other, or they share their first four letters,
 * or they are one letter apart (two for long words). Short words are
 * never forms of each other ("out", "at").
 */
function sameWord(a: string, b: string) {
  if (a === b) return true
  const shorter = Math.min(a.length, b.length)
  if (shorter < 4) return false
  let prefix = 0
  while (prefix < shorter && a[prefix] === b[prefix]) prefix++
  if (prefix === shorter || prefix >= 4) return true
  if (Math.abs(a.length - b.length) > 2) return false
  const row = Array.from({ length: b.length + 1 }, (_, k) => k)
  for (let x = 1; x <= a.length; x++) {
    let diag = row[0]!
    row[0] = x
    for (let y = 1; y <= b.length; y++) {
      const up = row[y]!
      row[y] = Math.min(
        row[y]! + 1,
        row[y - 1]! + 1,
        diag + (a[x - 1] === b[y - 1] ? 0 : 1)
      )
      diag = up
    }
  }
  return row[b.length]! <= (shorter >= 6 ? 2 : 1)
}

/** The pairs of drafted and sent sentences that are one sentence, edited. */
function pairsOf(drafted: Sentence[], sent: Sentence[], heads: boolean) {
  const pairs: [Sentence, Sentence][] = []
  const freeD = new Set(drafted.map((_, k) => k))
  const freeS = new Set(sent.map((_, k) => k))
  // An unchanged sentence is itself, wherever it went.
  const byText = new Map<string, number[]>()
  for (const k of freeS) {
    const list = byText.get(sent[k]!.text) ?? []
    list.push(k)
    byText.set(sent[k]!.text, list)
  }
  for (const k of [...freeD]) {
    const match = byText.get(drafted[k]!.text)?.shift()
    if (match === undefined) continue
    freeD.delete(k)
    freeS.delete(match)
  }
  // Then the subject with the subject, the preview line with the preview
  // line (when neither is an unchanged sentence of the other's).
  if (heads)
    for (const k of [0, 1])
      if (
        freeD.has(k) &&
        freeS.has(k) &&
        likeness(drafted[k]!, sent[k]!) >= sameLine
      ) {
        pairs.push([drafted[k]!, sent[k]!])
        freeD.delete(k)
        freeS.delete(k)
      }
  // Then the closest pairs first.
  const scored: { d: number; s: number; score: number }[] = []
  for (const d of freeD)
    for (const s of freeS) {
      const score = likeness(drafted[d]!, sent[s]!)
      if (score >= sameSentence) scored.push({ d, s, score })
    }
  scored.sort((x, y) => y.score - x.score || x.d - y.d || x.s - y.s)
  for (const { d, s } of scored) {
    if (!freeD.has(d) || !freeS.has(s)) continue
    freeD.delete(d)
    freeS.delete(s)
    pairs.push([drafted[d]!, sent[s]!])
  }
  return pairs
}

const isNumber = (w: string) => /\p{N}/u.test(w)

/**
 * The phrases the owner took out of one email, each once: one to four
 * words taken out, or swapped for at most four, that are gone from the
 * whole email he sent; never a number, a placeholder, the store's own
 * words (`keep`, as whole words), filler alone, a single word of fewer
 * than four letters, or a word swapped for another form of itself.
 */
export function removedPhrases(
  edit: Pick<OwnerEdit, 'drafted' | 'sent'>,
  keep: readonly string[] = []
): { phrase: string; instead: string }[] {
  const ours = keep
    .filter((k): k is string => typeof k === 'string')
    .map((k) => ` ${wordsOf(k).join(' ')} `)
    .filter((k) => k.trim())
  return removedFrom(sentencesOf(edit.drafted), sentencesOf(edit.sent), ours)
}

function removedFrom(drafted: Sentence[], sent: Sentence[], ours: string[]) {
  const still = groupsOf(sent.flatMap((s) => s.words))
  const found = new Map<string, string>()
  for (const [a, b] of pairsOf(drafted, sent, true)) {
    if (a.words.length > maxSentenceWords || b.words.length > maxSentenceWords)
      continue
    if (a.text === b.text) continue
    const spans = changes(a.words, b.words)
    if (spans.length > maxChanges) continue
    for (const span of spans) {
      if (!span.removed.length || span.removed.length > maxSpan) continue
      if (span.added.length > maxSpan || (span.atStart && span.atEnd)) continue
      // Light words around a phrase are not part of it.
      const core = [...span.removed]
      while (core.length && edges.has(core[0]!)) core.shift()
      while (core.length && edges.has(core.at(-1)!)) core.pop()
      if (!core.length || core.some(isNumber)) continue
      if (
        core.length === 1 &&
        (alone.has(core[0]!) ||
          core[0]!.includes("'") ||
          Array.from(core[0]!).length < minWordLetters)
      )
        continue
      // A word swapped for another form of itself is grammar, not a word.
      if (core.some((w) => span.added.some((x) => sameWord(w, x)))) continue
      const phrase = core.join(' ')
      // Still in the email he sent: moved, not taken out.
      if (still.has(phrase)) continue
      const padded = ` ${phrase} `
      if (ours.some((o) => o.includes(padded) || padded.includes(o))) continue
      const instead = [...span.added]
      while (instead.length && edges.has(instead[0]!)) instead.shift()
      while (instead.length && edges.has(instead.at(-1)!)) instead.pop()
      if (!found.has(phrase)) found.set(phrase, instead.join(' '))
    }
  }
  return [...found].map(([phrase, instead]) => ({ phrase, instead }))
}

/**
 * The words this brand never uses, from the owner's edits (the newest
 * last, every sent GROS email, changed or not): a phrase taken out of
 * `minRemovals` emails or more (a single word: `minWordRemovals`), and
 * taken out more often than GROS wrote it and the owner left it in, is
 * never used; the rest are watched. Each email counts once (by its id,
 * and once by its words).
 */
export function learnNeverWords(
  edits: readonly OwnerEdit[],
  keep: readonly string[] = []
): NeverWords {
  const ours = keep
    .filter((k): k is string => typeof k === 'string')
    .map((k) => ` ${wordsOf(k).join(' ')} `)
    .filter((k) => k.trim())
  const ids = new Set<string>()
  const texts = new Set<string>()
  const read: { drafted: Set<string>; sent: Set<string> }[] = []
  const seen = new Map<string, NeverWord>()
  for (const e of edits) {
    if (
      !e ||
      typeof e.messageId !== 'string' ||
      !e.messageId ||
      ids.has(e.messageId) ||
      !Array.isArray(e.drafted) ||
      !Array.isArray(e.sent)
    )
      continue
    const drafted = sentencesOf(e.drafted)
    const sent = sentencesOf(e.sent)
    const key = `${drafted.map((s) => s.text).join('|')}\n${sent.map((s) => s.text).join('|')}`
    if (texts.has(key)) continue
    ids.add(e.messageId)
    texts.add(key)
    read.push({
      drafted: groupsOf(drafted.flatMap((s) => s.words)),
      sent: groupsOf(sent.flatMap((s) => s.words))
    })
    for (const { phrase, instead } of removedFrom(drafted, sent, ours)) {
      const word = seen.get(phrase) ?? {
        phrase,
        removed: 0,
        kept: 0,
        instead: []
      }
      word.removed++
      if (instead) word.instead = [...word.instead, instead].slice(-3)
      seen.set(phrase, word)
    }
  }
  // Left in: GROS wrote it and it went out.
  for (const email of read)
    for (const word of seen.values())
      if (email.drafted.has(word.phrase) && email.sent.has(word.phrase))
        word.kept++
  const all = [...seen.values()].sort(
    (a, b) => b.removed - a.removed || a.kept - b.kept
  )
  const enough = (w: NeverWord) =>
    w.removed >= (w.phrase.includes(' ') ? minRemovals : minWordRemovals)
  const never = all
    .filter((w) => enough(w) && w.removed > w.kept)
    .slice(0, maxNeverWords)
  return {
    never,
    watched: all.filter((w) => !never.includes(w)).slice(0, maxNeverWords)
  }
}
