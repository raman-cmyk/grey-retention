import { hiddenChars } from '@/features/assembly/assemble'
import {
  minRecipients,
  offerWords,
  type HistorySnapshot
} from '@/features/onboarding/history/facts'

/**
 * PIC-26 part 1 (owner pick #26, "Subject line lab"): up to 10 subject
 * ideas for one email are weighed against how the store's own past
 * emails were opened, and the best two are kept: A goes out, B is the one
 * worth testing against it (part 3 sends them as a 50/50 test).
 *
 * How it weighs: each subject has traits (short, a question, an offer, the
 * reader's first name …). From the store's sent emails (`pastSubjects`),
 * each trait's open rate with it and without it is compared, and the
 * difference is shrunk by how sure it is (`learnFrom`): a difference no
 * bigger than the store's own ups and downs, for as few emails as show
 * it, counts for little. A subject's score is the sum of its
 * traits' differences; a trait the store's emails say nothing about counts
 * only by a small rule of thumb (a long subject is cut on a phone). Ties
 * keep the writer's order. Plain code, no AI: the same ideas and the same
 * history give the same pick.
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
/** Fewer usable past emails than this: rules of thumb only. */
export const minPastEmails = 10
/** A trait needs this many past emails with it, and as many without. */
export const minPerSide = 3
/** The least spread a store's open rates are taken to have (1 point). */
const minSpread = 0.01
/** No trait moves a score by more than this (15 points of open rate). */
const maxLift = 0.15
/** A B expected this far below A (5 points of open rate) is not worth the test. */
export const testMargin = 0.05
/** Two subjects with this share of both their words in common are one idea. */
const sameIdea = 0.6
/** The longest subject the lab weighs (the Copywriter keeps under 80). */
const maxSubjectChars = 120
/** At most this many past emails are read (a year's history holds 300). */
const maxPast = 300
/** A past subject longer than this is not read (the history keeps 300). */
const maxPastChars = 300
/** Comparing two scores: a difference smaller than this is none. */
const epsilon = 1e-9

/** The lab's version, kept with what it picks, to credit results later. */
export const subjectLabVersion = '2026-11-16.1'

export const subjectTraits = [
  'short',
  'long',
  'question',
  'number',
  'offer',
  'emoji',
  'personal',
  'brand',
  'deadline',
  'exclaim',
  'lowercase',
  'new',
  'you'
] as const
export type SubjectTrait = (typeof subjectTraits)[number]

/** Each trait in the owner's words, as the reasons say it. */
export const traitWords: Record<SubjectTrait, string> = {
  short: 'Short subjects (30 characters or fewer)',
  long: 'Long subjects (more than 50 characters)',
  question: 'Subjects that ask a question',
  number: 'Subjects with a number',
  offer: 'Subjects with an offer',
  emoji: 'Subjects with an emoji',
  personal: "Subjects with the reader's first name",
  brand: "Subjects with the store's name",
  deadline: 'Subjects with a deadline',
  exclaim: 'Subjects with an exclamation mark',
  lowercase: 'Subjects all in lower case',
  new: 'Subjects about something new',
  you: 'Subjects that say "you"'
}

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

// ---------------------------------------------------------------- traits

/** A Klaviyo tag in a subject (`{{ first_name|default:'there' }}`). */
const tag = /\{\{[^{}]{0,200}\}\}/g
/** Klaviyo's logic tags (`{% if first_name %}`): never seen by a reader. */
const logic = /\{%[^{}]{0,200}%\}/g
const firstNameTag =
  /^\{\{\s*(?:person\.)?first[ _]?name\b|^\{\{\s*person\|lookup:\s*['"]first[ _]?name/i
const storeTag = /^\{\{\s*organization\.name\b/i
/** A deadline, as a phrase: "ends tonight", "last chance", never "the story never ends". */
const deadline =
  /\b(?:(?:ends?|ending|closes?|closing)\s+(?:today|tonight|tomorrow|soon|at midnight|on \w+day|\w+day|this (?:week|weekend)|in \d+ (?:hours?|days?)|\d{1,2}\/\d{1,2})|(?:today|tonight) only|only today|\d+ hours? (?:only|left)|last (?:chance|call|day|hours?)|final (?:hours?|day|call)|hours? left|only \d+ left|hurry|don['’]t miss|until midnight)\b/i
/** Something new, never "New Year", "New York" or "just in time". */
const somethingNew =
  /\b(?:new\b(?!\s+(?:year|years|york|zealand|jersey|mexico|orleans|hampshire)\b)|just (?:in\b(?!\s+time\b)|landed|dropped|arrived)|introducing|launch(?:es|ed|ing)?|first look|back in stock|restock(?:ed|ing)?)\b/i
const you = /\b(?:you|your|yours|yourself|yourselves|you['’](?:re|ll|ve|d))\b/i
/** A picture character, a flag or a keycap; never ©, ® or ™. */
const emoji =
  /(?![©®™])\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u
/** Characters a reader never sees (as `subjectText` drops them), and a soft hyphen. */
const unseen = new RegExp(`${hiddenChars.source}|\u00ad`, 'g')

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The subject as a reader sees it: a first name for its tag, the store's name for its own. */
function shown(subject: string, brand: string) {
  // Spaces first (a tab or a line break is one), then what no one sees.
  return subject
    .replace(/\s+/g, ' ')
    .replace(unseen, '')
    .replace(logic, ' ')
    .replace(tag, (t) =>
      firstNameTag.test(t) ? 'Alex' : storeTag.test(t) ? brand : ''
    )
    .replace(/\s+/g, ' ')
    .trim()
}

/** What a subject does, by plain code (`subjectTraits`). */
export function traitsOf(subject: string, brand: string): SubjectTrait[] {
  const name = brand
    .replace(/\s+/g, ' ')
    .replace(unseen, '')
    .replace(/\s+/g, ' ')
    .trim()
  const text = shown(subject, name)
  const chars = Array.from(text).length
  const found = new Set<SubjectTrait>()
  if (chars > 0 && chars <= 30) found.add('short')
  if (chars > 50) found.add('long')
  if (text.includes('?')) found.add('question')
  if (text.includes('!')) found.add('exclaim')
  if (offerWords.test(text)) found.add('offer')
  else if (/\d/.test(text)) found.add('number')
  if (emoji.test(text)) found.add('emoji')
  if ((subject.match(tag) ?? []).some((t) => firstNameTag.test(t)))
    found.add('personal')
  if (
    name &&
    new RegExp(
      `(?<![\\p{L}\\p{N}])${escaped(name)}(?![\\p{L}\\p{N}])`,
      'iu'
    ).test(text)
  )
    found.add('brand')
  if (deadline.test(text)) found.add('deadline')
  // All lower case, a tag's name aside ("{{ first_name }}, your order");
  // a script without capitals is not lower case.
  const bare = subject.replace(logic, ' ').replace(tag, ' ')
  if (/\p{Ll}/u.test(bare) && !/[\p{Lu}\p{Lt}]/u.test(bare))
    found.add('lowercase')
  if (somethingNew.test(text)) found.add('new')
  if (you.test(text)) found.add('you')
  return subjectTraits.filter((t) => found.has(t))
}

// ---------------------------------------------------------------- evidence

/** A past email's subject and the share of its recipients who opened it. */
export type PastSubject = {
  subject: string
  recipients: number
  openRate: number
}

/**
 * The sent emails whose subject and opens can teach: a subject, an open
 * rate above 0 (no opens at all is opens not tracked), enough recipients
 * (`minRecipients`), not an A/B test (its rate mixes two subjects) and not
 * still collecting its results.
 */
export function pastSubjects(
  history: Pick<HistorySnapshot, 'sent'>
): PastSubject[] {
  return history.sent.flatMap((e) =>
    e.subject?.trim() &&
    e.openRate !== null &&
    e.openRate > 0 &&
    e.recipients !== null &&
    e.recipients >= minRecipients &&
    !e.abTest &&
    !e.collecting
      ? [{ subject: e.subject, recipients: e.recipients, openRate: e.openRate }]
      : []
  )
}

/** What the store's emails say about one trait. */
export type TraitEvidence = {
  /** Mean open rate of the emails with it, and of those without. */
  withRate: number
  withoutRate: number
  withCount: number
  withoutCount: number
  /** The difference, shrunk by how sure it is (open rate, -0.15 to 0.15). */
  lift: number
}

export type SubjectEvidence = {
  /** The usable past emails read. */
  emails: number
  /** Their mean open rate; null with fewer than `minPastEmails`. */
  meanOpenRate: number | null
  traits: Partial<Record<SubjectTrait, TraitEvidence>>
}

const mean = (values: readonly number[]) =>
  values.reduce((n, v) => n + v, 0) / values.length

const usable = (p: PastSubject) =>
  typeof p.subject === 'string' &&
  p.subject.trim() !== '' &&
  p.subject.length <= maxPastChars &&
  Number.isFinite(p.openRate) &&
  p.openRate > 0 &&
  p.openRate <= 1 &&
  Number.isFinite(p.recipients) &&
  p.recipients >= minRecipients

/**
 * Each trait's open rate with it and without it in the store's own
 * emails, once per plan. The difference is shrunk by how sure it is: by
 * d² / (d² + se²), where se is the noise of that difference (each
 * group's own spread of open rates, never below the store's, at least 1
 * point, for as many emails as each side has). A trait shown by fewer
 * than `minPerSide` emails on either side says nothing; fewer than
 * `minPastEmails` emails in all say nothing at all (rules of thumb only).
 */
export function learnFrom(
  past: readonly PastSubject[],
  brand: string
): SubjectEvidence {
  const rows = past
    .filter(usable)
    .slice(0, maxPast)
    .map((p) => ({
      rate: p.openRate,
      traits: new Set(traitsOf(p.subject, brand))
    }))
  if (rows.length < minPastEmails)
    return { emails: rows.length, meanOpenRate: null, traits: {} }
  const traits: SubjectEvidence['traits'] = {}
  const squares = (values: readonly number[], m: number) =>
    values.reduce((n, v) => n + (v - m) ** 2, 0)
  for (const trait of subjectTraits) {
    const yes = rows.filter((r) => r.traits.has(trait)).map((r) => r.rate)
    const no = rows.filter((r) => !r.traits.has(trait)).map((r) => r.rate)
    if (yes.length < minPerSide || no.length < minPerSide) continue
    const withRate = mean(yes)
    const withoutRate = mean(no)
    const diff = withRate - withoutRate
    // Each side's own spread, never below the store's: one lucky email
    // among three is noise, not a trait.
    const ssYes = squares(yes, withRate)
    const ssNo = squares(no, withoutRate)
    const pooled = Math.max(
      minSpread ** 2,
      (ssYes + ssNo) / (yes.length + no.length - 2)
    )
    const noise =
      Math.max(pooled, ssYes / (yes.length - 1)) / yes.length +
      Math.max(pooled, ssNo / (no.length - 1)) / no.length
    const shrunk = diff === 0 ? 0 : (diff * diff ** 2) / (diff ** 2 + noise)
    traits[trait] = {
      withRate,
      withoutRate,
      withCount: yes.length,
      withoutCount: no.length,
      lift: Math.max(-maxLift, Math.min(maxLift, shrunk))
    }
  }
  return {
    emails: rows.length,
    meanOpenRate: mean(rows.map((r) => r.rate)),
    traits
  }
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
    subject
      .replace(logic, ' ')
      .replace(tag, ' ')
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
  const a = best[0] ?? null
  const b =
    (a &&
      best
        .slice(1)
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
    learned: evidence.meanOpenRate !== null,
    emails: evidence.emails
  }
}
