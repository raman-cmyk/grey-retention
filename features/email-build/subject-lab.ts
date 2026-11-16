import {
  subjectTraits,
  traitsOf,
  traitWords,
  withoutTags,
  type SubjectEvidence,
  type SubjectTrait
} from './subject-traits'

/**
 * PIC-26 part 1b (owner pick #26, "Subject line lab"): up to 10 subject
 * ideas for one email are weighed against how the store's own past
 * emails were opened (part 1a's evidence, `learnFrom`), and the best two
 * are kept: A goes out, B is the one worth testing against it (part 3
 * sends them as a 50/50 test).
 *
 * A subject's score is the sum of its traits' lifts; a trait the store's
 * emails say nothing about counts only by a small rule of thumb (a long
 * subject is cut on a phone). Ties keep the writer's order. Plain code, no
 * AI: the same ideas and the same history give the same pick.
 *
 * B is the best idea after A that differs from it in a trait (so the test
 * teaches something), is not the same idea in other words, and is not
 * expected to do much worse (half the audience gets it). None fits: no
 * test.
 *
 * Nothing calls it yet: part 2 has the Copywriter write the ideas and the
 * copy step keep A and B; part 3 sends B to Klaviyo.
 */

/** How many subject ideas the lab weighs for one email. */
export const labSize = 10
/** A B expected this far below A (5 points of open rate) is not worth the test. */
export const testMargin = 0.05
/** Two subjects with this share of both their words in common are one idea. */
const sameIdea = 0.6
/** The longest subject the lab weighs (the Copywriter keeps under 80). */
const maxSubjectChars = 120
/** Comparing two scores: a difference smaller than this is none. */
const epsilon = 1e-9

/** The lab's version, kept with what it picks, to credit results later. */
export const subjectLabVersion = '2026-11-16.2'

/**
 * Rules of thumb for a trait the store's own emails say nothing about,
 * kept small, and never for a trait the store's emails show: a phone shows about 35
 * characters of a subject, and an exclamation mark reads as shouting.
 */
const ruleOfThumb: Partial<Record<SubjectTrait, number>> = {
  short: 0.005,
  long: -0.01,
  exclaim: -0.005
}
const ruleWords: Partial<Record<SubjectTrait, string>> = {
  short: 'A short subject shows whole on a phone (a rule of thumb).',
  long: 'A long subject is cut on a phone (a rule of thumb).',
  exclaim: 'An exclamation mark can read as shouting (a rule of thumb).'
}

// ---------------------------------------------------------------- the lab

export type RankedSubject = {
  subject: string
  /** Where the idea was in the list given (to find its preview line again). */
  index: number
  traits: SubjectTrait[]
  /** The sum of its traits' lifts and rules of thumb (open rate). */
  score: number
  /**
   * The open rate the store's emails point to (their mean, moved by each
   * trait the store's emails show, by how much more or less it has it than
   * they do); null without evidence.
   */
  expected: number | null
  /** Why, in the owner's words: at most three reasons, the strongest first. */
  why: string[]
}

export type SubjectLab = {
  /** The subject that goes out; null when no idea fits. */
  a: RankedSubject | null
  /** The one worth testing against A; null when none is. */
  b: RankedSubject | null
  /** The traits A and B differ in: what the test teaches. */
  tests: SubjectTrait[]
  /** Every idea that fits, best first. */
  ranked: RankedSubject[]
  /** True when the store's own emails weighed the ideas. */
  learned: boolean
  /** The past emails read. */
  emails: number
}

const percent = (rate: number) => `${Math.round(rate * 100)}%`
// As `subjectKey` in build.ts, kept here: build.ts will import this file.
const keyOf = (subject: string) =>
  subject.replace(/\s+/g, ' ').trim().toLowerCase()

/** A subject's words, for telling two ideas apart. */
const wordsOf = (subject: string) =>
  new Set(
    withoutTags(subject)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
  )
function overlap(a: string, b: string) {
  const x = wordsOf(a)
  const y = wordsOf(b)
  const all = new Set([...x, ...y]).size
  if (!all) return 1
  return [...x].filter((w) => y.has(w)).length / all
}

function ranked(
  subject: string,
  index: number,
  evidence: SubjectEvidence,
  brand: string
): RankedSubject {
  const traits = traitsOf(subject, brand)
  const learned = evidence.meanOpenRate !== null
  let score = 0
  // The mean already holds each trait as often as the store used it: an
  // idea moves from it by how much more (or less) it has the trait.
  let lifted = 0
  for (const [trait, seen] of Object.entries(evidence.traits)) {
    const share = seen.withCount / (seen.withCount + seen.withoutCount)
    lifted +=
      ((traits.includes(trait as SubjectTrait) ? 1 : 0) - share) * seen.lift
  }
  const reasons: { weight: number; text: string }[] = []
  for (const trait of traits) {
    const seen = evidence.traits[trait]
    if (seen) {
      score += seen.lift
      if (
        Math.abs(seen.lift) >= 0.005 &&
        percent(seen.withRate) !== percent(seen.withoutRate)
      )
        reasons.push({
          weight: Math.abs(seen.lift),
          text: `${traitWords[trait]}: ${percent(seen.withRate)} opened, the others ${percent(seen.withoutRate)} (${seen.withCount} of ${evidence.emails} emails).`
        })
      continue
    }
    const rule = ruleOfThumb[trait]
    if (rule === undefined) continue
    score += rule
    reasons.push({ weight: Math.abs(rule) / 2, text: ruleWords[trait]! })
  }
  return {
    subject,
    index,
    traits,
    score,
    expected: learned
      ? Math.max(0, Math.min(1, evidence.meanOpenRate! + lifted))
      : null,
    why: reasons
      .sort((x, y) => y.weight - x.weight)
      .slice(0, 3)
      .map((r) => r.text)
  }
}

/** Whether a B this far below A is worth half the audience (`testMargin`). */
export const worthTesting = (a: number, b: number) =>
  b >= a - testMargin - epsilon

/**
 * Weighs up to `labSize` subject ideas (the writer's order: its own pick
 * first) and keeps the best two. `fits` is the caller's checks (the copy
 * checks, a subject another email of the plan has, the preview line): an
 * idea that fails them is never weighed. Ideas the same but for case and
 * spacing count once (the same subject again is tried while none of its
 * spellings fitted: another preview line may); an empty or very long one
 * is left out. At most `labSize` ideas are tried.
 */
export function subjectLab(
  ideas: readonly string[],
  evidence: SubjectEvidence,
  input: {
    brand: string
    /** The caller's checks, with the idea's place in the list given. */
    fits?: (subject: string, index: number) => boolean
    /**
     * Without the store's own opens, the first idea that fits stays A (the
     * writer's own pick): rules of thumb only choose what to test against it.
     */
    keepFirst?: boolean
  }
): SubjectLab {
  const fits = input.fits ?? (() => true)
  // An idea that fits is kept once; the same subject again is tried again
  // only while none of its spellings fitted (another preview line may).
  const seen = new Set<string>()
  const order: RankedSubject[] = []
  let tried = 0
  ideas.forEach((idea, index) => {
    if (tried >= labSize || typeof idea !== 'string') return
    const subject = idea.replace(/\s+/g, ' ').trim()
    const key = keyOf(subject)
    if (!subject || subject.length > maxSubjectChars || seen.has(key)) return
    tried++
    if (!fits(subject, index)) return
    seen.add(key)
    order.push(ranked(subject, index, evidence, input.brand))
  })
  // A stable sort on rounded scores: equal scores keep the writer's order.
  const rounded = (r: RankedSubject) => Math.round(r.score * 1e6)
  const best = [...order].sort((x, y) => rounded(y) - rounded(x))
  const learned = evidence.meanOpenRate !== null
  const a = (input.keepFirst && !learned ? order[0] : best[0]) ?? null
  const b =
    (a &&
      best
        .filter((r) => r !== a)
        .find(
          (r) =>
            worthTesting(a.score, r.score) &&
            overlap(r.subject, a.subject) < sameIdea &&
            (r.traits.length !== a.traits.length ||
              r.traits.some((t) => !a.traits.includes(t)))
        )) ??
    null
  const tests =
    a && b
      ? subjectTraits.filter(
          (t) => a.traits.includes(t) !== b.traits.includes(t)
        )
      : []
  return {
    a,
    b,
    tests,
    ranked: best,
    learned,
    emails: evidence.emails
  }
}
