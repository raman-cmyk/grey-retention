/**
 * PIC-29 part 1 (owner pick #29, "Words this brand never uses"): the words
 * the owner takes out of GROS's emails, learned from his edits. An email
 * GROS drafted is compared with the email that went out (its subject, its
 * preview line, its lines of text), sentence by sentence: a sentence the
 * owner kept but changed is compared word by word, and a few words he took
 * out (or swapped for others) while the words around them stayed are one
 * removal (`removedPhrases`). A whole sentence rewritten or dropped says
 * nothing about a word, so it is never read as one.
 *
 * Across emails (`learnNeverWords`), a phrase the owner took out of two
 * emails or more, and never left in when GROS wrote it, is one this brand
 * never uses: the copy checks then refuse it (`BrandFacts.bannedPhrases`)
 * and the writers are told. One removal is only watched. Numbers (a price,
 * a date), the store's own words (its name, its products) and words that
 * carry no meaning alone ("the", "and") are never learned.
 *
 * Plain code, no AI and no database: part 2 keeps what each email's edit
 * showed, and part 3 reads the email that went out from Klaviyo.
 */

/** One email GROS drafted and the same email as it went out. */
export type OwnerEdit = {
  messageId: string
  /** GROS's subject, preview line and lines of text. */
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
  /** Taken out of two emails or more and never left in: refused from now on. */
  never: NeverWord[]
  /** Taken out once, or as often left in: watched, not refused. */
  watched: NeverWord[]
}

/** Two removals make a word one the brand never uses. */
export const minRemovals = 2
/** A removal is at most this many words, swapped for at most as many. */
const maxSpan = 4
/** Words on each side that must stay for a removal to count. */
const context = 1
/** Two sentences are the same sentence when they share this share of words. */
const sameSentence = 0.5
/** Sentences longer than this are not compared word by word. */
const maxSentenceWords = 80
/** At most this many lines of an email, and words in all, are read. */
const maxLines = 400
const maxWords = 5_000
/** At most this many never-used phrases are kept (copy QA's list is 200). */
export const maxNeverWords = 100

/** Words that mean nothing alone: never learned on their own. */
const filler = new Set(
  'a an the and or but so of to in on at by for with from as is are was were be been it its this that these those our your my we you i us they them he she his her their there here very just really also then now'.split(
    ' '
  )
)

const norm = (text: string) =>
  text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'")
/** A line's words: letters, digits, apostrophes and hyphens inside a word. */
const wordsOf = (text: string) =>
  norm(text).match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? []

/** A text's sentences, as their words (a line is at least one). */
function sentencesOf(lines: readonly string[]) {
  const out: string[][] = []
  let total = 0
  for (const line of lines.slice(0, maxLines)) {
    if (typeof line !== 'string') continue
    for (const part of line.split(/(?<=[.!?])\s+/)) {
      const words = wordsOf(part)
      if (!words.length) continue
      total += words.length
      if (total > maxWords) return out
      out.push(words)
    }
  }
  return out
}

function overlap(a: readonly string[], b: readonly string[]) {
  const x = new Set(a)
  const y = new Set(b)
  const all = new Set([...x, ...y]).size
  return all ? [...x].filter((w) => y.has(w)).length / all : 0
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
    before: number
    after: number
  }[] = []
  let i = 0
  let j = 0
  let same = 0
  let open: { removed: string[]; added: string[]; before: number } | null = null
  const close = () => {
    if (open) spans.push({ ...open, after: 0 })
    open = null
  }
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      if (open) close()
      same++
      // The words after the last span, counted as they come.
      const last = spans.at(-1)
      if (last && last.after < context) last.after++
      i++
      j++
      continue
    }
    if (!open) {
      open = { removed: [], added: [], before: same }
      same = 0
    }
    if (j >= m || (i < n && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      open.removed.push(a[i]!)
      i++
    } else {
      open.added.push(b[j]!)
      j++
    }
  }
  close()
  return spans
}

/**
 * The phrases the owner took out of one email, each once: a span of at
 * most four words taken out, or swapped for at most four, with a word kept
 * on each side (or the sentence's start or end, not both); never a number,
 * the store's own words (`keep`) or filler alone. The lines are what a
 * reader sees (Klaviyo's tags as placeholders).
 */
export function removedPhrases(
  edit: Pick<OwnerEdit, 'drafted' | 'sent'>,
  keep: readonly string[] = []
): { phrase: string; instead: string }[] {
  const drafted = sentencesOf(edit.drafted)
  const sent = sentencesOf(edit.sent)
  const ours = keep.map((k) => wordsOf(k).join(' ')).filter(Boolean)
  const used = new Set<number>()
  const found = new Map<string, string>()
  for (const words of drafted) {
    if (words.length > maxSentenceWords) continue
    // The sentence as it went out: the most alike, used once.
    let best = -1
    let score = sameSentence
    sent.forEach((other, k) => {
      if (used.has(k) || other.length > maxSentenceWords) return
      const s = overlap(words, other)
      if (s >= score) {
        best = k
        score = s
      }
    })
    if (best < 0) continue
    used.add(best)
    const other = sent[best]!
    if (words.join(' ') === other.join(' ')) continue
    const spans = changes(words, other)
    // Many changes in one sentence is a rewrite, not a word taken out.
    if (spans.length > 3) continue
    for (const span of spans) {
      if (!span.removed.length || span.removed.length > maxSpan) continue
      if (span.added.length > maxSpan) continue
      const atStart = span.before === 0
      const atEnd = span.after === 0
      if (
        (!atStart && span.before < context) ||
        (!atEnd && span.after < context)
      )
        continue
      if (atStart && atEnd) continue
      // Filler around a phrase is not part of it.
      const core = [...span.removed]
      while (core.length && filler.has(core[0]!)) core.shift()
      while (core.length && filler.has(core.at(-1)!)) core.pop()
      if (!core.length || core.some((w) => /\d/.test(w))) continue
      const phrase = core.join(' ')
      // The store's own words, as whole words either way.
      if (
        ours.some(
          (o) =>
            ` ${o} `.includes(` ${phrase} `) || ` ${phrase} `.includes(` ${o} `)
        )
      )
        continue
      if (!found.has(phrase)) found.set(phrase, span.added.join(' '))
    }
  }
  return [...found].map(([phrase, instead]) => ({ phrase, instead }))
}

/** Whether a text holds a phrase as whole words. */
const holds = (words: readonly string[], phrase: string) =>
  ` ${words.join(' ')} `.includes(` ${phrase} `)

/**
 * The words this brand never uses, from the owner's edits (the newest
 * last): a phrase taken out of `minRemovals` emails or more, and taken out
 * more often than left in, is never used; the rest are watched. Each email
 * counts once per phrase.
 */
export function learnNeverWords(
  edits: readonly OwnerEdit[],
  keep: readonly string[] = []
): NeverWords {
  const seen = new Map<string, NeverWord>()
  const emails = new Set<string>()
  const read = edits.filter((e) => {
    if (!e || typeof e.messageId !== 'string' || emails.has(e.messageId))
      return false
    emails.add(e.messageId)
    return Array.isArray(e.drafted) && Array.isArray(e.sent)
  })
  for (const edit of read)
    for (const { phrase, instead } of removedPhrases(edit, keep)) {
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
  // Left in: GROS wrote it and it went out.
  for (const edit of read) {
    const drafted = sentencesOf(edit.drafted).flat()
    const sent = sentencesOf(edit.sent).flat()
    for (const word of seen.values())
      if (holds(drafted, word.phrase) && holds(sent, word.phrase)) word.kept++
  }
  const all = [...seen.values()].sort(
    (a, b) => b.removed - a.removed || a.kept - b.kept
  )
  const never = all
    .filter((w) => w.removed >= minRemovals && w.removed > w.kept)
    .slice(0, maxNeverWords)
  return {
    never,
    watched: all.filter((w) => !never.includes(w)).slice(0, maxNeverWords)
  }
}
