import { hiddenChars } from '@/features/assembly/assemble'
import {
  minRecipients,
  offerWords,
  type HistorySnapshot
} from '@/features/onboarding/history/facts'

/**
 * PIC-26 part 1a (owner pick #26, "Subject line lab"): what a subject
 * does, and what the store's own past emails say about it. Each subject
 * has traits found by plain code (`traitsOf`: short, a question, an
 * offer, the reader's first name …). From the store's sent emails
 * (`pastSubjects`), each trait's open rate with it and without it is
 * compared, and the difference is shrunk by how sure it is (`learnFrom`):
 * a difference no bigger than the store's own ups and downs, for as few
 * emails as show it, counts for little. Plain code, no AI: the same
 * history gives the same evidence.
 *
 * Part 1b (`subject-lab.ts`) weighs up to 10 subject ideas with it and
 * keeps A and B; part 2 has the Copywriter write the ideas; part 3 sends B
 * to Klaviyo as a 50/50 test.
 */

/** Fewer usable past emails than this: no evidence at all. */
export const minPastEmails = 10
/** A trait needs this many past emails with it, and as many without. */
export const minPerSide = 3
/** The least spread a store's open rates are taken to have (1 point). */
const minSpread = 0.01
/** No trait moves a score by more than this (15 points of open rate). */
const maxLift = 0.15
/** At most this many past emails are read (a year's history holds 300). */
const maxPast = 300
/** A past subject longer than this is not read (the history keeps 300). */
const maxPastChars = 300

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

/** A subject's words as a reader sees them, Klaviyo's tags out. */
export const withoutTags = (subject: string) =>
  subject.replace(logic, ' ').replace(tag, ' ')
