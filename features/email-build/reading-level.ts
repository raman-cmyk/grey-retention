import { blockWords, type Draft } from '@/features/assembly/assemble'
import type { BlockType } from '@/features/blocks/catalog'
import { visibleText } from '@/features/copy-qa/check'
import type { Industry } from '@/features/intelligence/taxonomy'
import type { Finding } from './inspect'

/**
 * DST-PIC #28 ("Length and reading level per industry"): targets for the
 * words in each section and the reading level, by the store's industry.
 * Shoppers skim an email: short sections and plain words read faster, and
 * a store that sells skincare or electronics may explain a little more
 * than one that sells clothes. The writers are told their industry's
 * targets (`readingRule`), and code sends a written draft or letter back
 * when it misses them (`readingFindings`, `letterReading`), with the
 * reason, as every other check (D21). Only what the writers wrote is
 * judged: store text (names, titles, the founder's and the customers' own
 * words) is masked first, and the plain copy, which is fixed facts, is
 * never held to it.
 *
 * The reading level is the Flesch-Kincaid grade (the school year that
 * reads it easily), from the sentences, words and syllables; it is read
 * for English text of at least `minGradeWords` words only (another
 * language, or a few words, is not judged). A draft passes up to two grades
 * over its target.
 */
export type ReadingTarget = {
  /** The highest school grade the words should need. */
  grade: number
  /** The most words in one section the writer writes. */
  sectionWords: number
}

export const readingTargets: Record<Industry, ReadingTarget> = {
  apparel: { grade: 7, sectionWords: 50 },
  accessories: { grade: 7, sectionWords: 50 },
  jewelry: { grade: 7, sectionWords: 50 },
  beauty: { grade: 7, sectionWords: 50 },
  haircare: { grade: 7, sectionWords: 60 },
  skincare: { grade: 8, sectionWords: 70 },
  beauty_tools: { grade: 8, sectionWords: 70 },
  supplements: { grade: 8, sectionWords: 70 },
  wellness: { grade: 8, sectionWords: 70 },
  fitness: { grade: 7, sectionWords: 60 },
  food_drink: { grade: 7, sectionWords: 60 },
  kitchen: { grade: 7, sectionWords: 60 },
  home: { grade: 7, sectionWords: 60 },
  pet: { grade: 6, sectionWords: 50 },
  baby: { grade: 7, sectionWords: 60 },
  outdoor: { grade: 8, sectionWords: 70 },
  electronics: { grade: 9, sectionWords: 80 },
  other: { grade: 8, sectionWords: 60 }
}

/** The store's targets (an unknown industry: `other`'s). */
export const readingTarget = (industry: string | null | undefined) =>
  Object.hasOwn(readingTargets, industry ?? '')
    ? readingTargets[industry as Industry]
    : readingTargets.other

/** The fewest words a reading level is read from. */
export const minGradeWords = 40
/** How far over its grade a draft may read and still pass. */
export const gradeSlack = 2

/** What the writer is told. */
export const readingRule = (industry: string | null | undefined) => {
  const t = readingTarget(industry)
  return `Write for a reader of school grade ${t.grade} or below: short sentences and plain, everyday words. Keep each section to ${t.sectionWords} words at most.`
}

const englishWord = /^[a-z]+(?:'[a-z]+)?$/
/** English's commonest words: a quarter or more of most English text. */
const commonEnglish = new Set(
  'a an the and or but of to in on at for with from by as is are was be it its this that you your we our us i my they their he she not no so if all can will just'.split(
    ' '
  )
)

/** The syllables of an English word, by its groups of vowels. */
export function syllables(word: string) {
  const w = word.toLowerCase().replace(/'.*$/, '')
  if (w.length <= 3) return 1
  const groups =
    w
      .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
      .replace(/^y/, '')
      .match(/[aeiouy]{1,2}/g)?.length ?? 0
  return Math.max(1, groups)
}

/**
 * The text's Flesch-Kincaid grade, rounded to one decimal; null when it is
 * not English enough (fewer than 85 in 100 words are plain English
 * letters, or fewer than 10 in 100 are English's commonest words) or has
 * fewer than `minGradeWords` words.
 */
export function readingGrade(text: string): number | null {
  const words = (
    text
      .toLowerCase()
      .replace(/’/g, "'")
      .match(/[\p{L}\p{N}']+/gu) ?? []
  )
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean)
  if (words.length < minGradeWords) return null
  const english = words.filter((w) => englishWord.test(w))
  if (english.length * 100 < words.length * 85) return null
  // Plain letters are not enough: German or Dutch is mostly a to z too.
  const common = words.filter((w) => commonEnglish.has(w)).length
  if (common * 100 < words.length * 10) return null
  const sentences = Math.max(
    1,
    text.split(/[.!?]+(?:\s|$)|\n+/).filter((s) => /[\p{L}\p{N}]/u.test(s))
      .length
  )
  const syll = english.reduce((n, w) => n + syllables(w), 0)
  const grade =
    0.39 * (words.length / sentences) + 11.8 * (syll / english.length) - 15.59
  return Math.round(grade * 10) / 10
}

/** Words as a reader counts them. */
const wordCount = (text: string) =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const masked = (text: string, own: readonly string[]) =>
  own
    .filter((t) => t.trim().length >= 2)
    .sort((a, b) => b.length - a.length)
    .reduce((t, o) => t.replace(new RegExp(escape(o), 'gi'), ' '), text)

/** Sections whose words are the store's, never the writer's. */
const placed = new Set<BlockType>([
  'founder_note',
  'review_strip',
  'ugc_grid',
  'header_logo',
  'footer'
])

/**
 * A written draft's sections over their words and its words over their
 * grade, as findings for the Copywriter. `own` is the store's text
 * (`protectedText`).
 */
export function readingFindings(
  draft: Pick<Draft, 'blocks'>,
  industry: string | null | undefined,
  own: readonly string[] = []
): Finding[] {
  const t = readingTarget(industry)
  const out: Finding[] = []
  const texts: string[] = []
  draft.blocks.forEach((block, i) => {
    if (placed.has(block.type)) return
    const text = masked(visibleText(blockWords(block).join('\n')), own)
    texts.push(text)
    const n = wordCount(text)
    if (n > t.sectionWords)
      out.push({
        by: 'code',
        rule: 'section_words',
        field: `${i + 1}-${block.type}`,
        reason: `This section has ${n} words; keep it to ${t.sectionWords} at most: say less, in short sentences.`
      })
  })
  const grade = readingGrade(texts.join('\n'))
  if (grade !== null && grade > t.grade + gradeSlack)
    out.push({
      by: 'code',
      rule: 'reading_level',
      field: 'email',
      reason: `The words read at school grade ${Math.round(grade)}; write for grade ${t.grade}: shorter sentences and plainer words.`
    })
  return out
}

/**
 * A written letter's words over their grade, for the Letter writer. Its
 * length has the letter's own limits (80 to 250 words).
 */
export function letterReading(
  parts: readonly string[],
  industry: string | null | undefined,
  own: readonly string[] = []
): { rule: string; reason: string }[] {
  const t = readingTarget(industry)
  const grade = readingGrade(parts.map((p) => masked(p, own)).join('\n'))
  return grade !== null && grade > t.grade + gradeSlack
    ? [
        {
          rule: 'reading_level',
          reason: `The letter reads at school grade ${Math.round(grade)}; write for grade ${t.grade}: shorter sentences and plainer words.`
        }
      ]
    : []
}
