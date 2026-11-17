import { oneLine } from '@/features/assembly/assemble'
import type { CompetitorLayout } from '@/features/assembly/modes'
import { isBlockType, type BlockType } from '@/features/blocks/catalog'
import type { BuildMode } from '@/features/email-build/sections'
import { layoutOf } from '@/features/inbox/winners'
import type { EmailType as InboxEmailType } from '@/features/intelligence/taxonomy'
import type { EmailType } from '@/features/strategy/plan'
import {
  copyKeepable,
  designable,
  liveTone,
  type StoryboardInput,
  type Tone
} from './storyboard'

/**
 * DST-002b (part a): the reference email for Copy and Remix, picked from
 * the Inspiration inbox, and what the Section planner and the Art director
 * take from it. Code only: the inbox's tagged sections (INB-003, CI-001)
 * are read by the build's worker (they are not a member's to read), and
 * this module turns them into the layout Copy follows (`CompetitorLayout`)
 * and the reference the storyboard keeps to (family, tone, height).
 */

/** One tagged section of an inbox email, top to bottom. */
export type ReferenceSection = {
  /** One of the 20 families, `unsure`, or a footer (the owner's label over the labeller's). */
  blockType: string
  /** CSS px at 600 wide, from the email's screenshot; null when unknown. */
  height: number | null
  purpose?: string | null
  styles?: readonly string[]
}

/**
 * An inbox email that could be the reference. Only a brand the workspace
 * follows, or a sample brand, may be offered (`pickReference` filters):
 * the inbox is platform-wide and its names and subjects reach the owner.
 */
export type ReferenceEmail = {
  id: string
  /** The sender brand (`competitor_captures.id`). */
  brandId: string
  /** The sender brand's name, for the owner's words only. */
  brand: string
  /** A sample brand (`.example`), shown to every workspace. */
  synthetic: boolean
  subject: string
  industry: string | null
  emailType: string | null
  /** The inbox's angle label: structure only, for Remix. */
  angle: string | null
  /** ISO time it reached the inbox. */
  receivedAt: string
  sections: readonly ReferenceSection[]
  /** Its layout is one its brand sends again and again (CMP-047). */
  winner: boolean
}

/** The tallest a reference section may be (a whole email is about 2,400). */
const maxSectionHeight = 4_000

const usableHeight = (h: number | null): h is number =>
  h !== null && Number.isFinite(h) && h > 0 && h <= maxSectionHeight

/** A designed section's reference height Copy can keep (`copyKeepable`). */
const keepable = (h: number | null): h is number =>
  usableHeight(h) && h >= copyKeepable.min && h <= copyKeepable.max

/**
 * A section's own tone: dark when the inbox tagged it dark, an offer
 * stands out, else the tone its live block has.
 */
export function sectionTone(s: ReferenceSection): Tone {
  if (s.styles?.includes('dark')) return 'dark'
  if (s.purpose === 'offer') return 'accent'
  return isBlockType(s.blockType) ? liveTone(s.blockType) : 'light'
}

/**
 * What a build takes from its reference: the layout Copy follows and Remix
 * learns its structure from (sections in order, the angle as structure
 * only), the reference sections with their own tones (a hero its tagged
 * tone, a live section its block's), and, for each layout section, its
 * place in that reference (null when it has none: an unnamed part, a
 * footer, an unknown height). A planned section's `source` (Copy) is its
 * layout index; `plannedReference` gives the storyboard what it keeps.
 */
export function referenceDna(email: ReferenceEmail): {
  layout: CompetitorLayout
  reference: NonNullable<StoryboardInput['reference']>
  refIndex: (number | null)[]
} {
  const reference: NonNullable<StoryboardInput['reference']> = []
  const refIndex: (number | null)[] = []
  const sections = email.sections.slice(0, 40)
  for (const s of sections) {
    if (
      !isBlockType(s.blockType) ||
      s.blockType === 'footer' ||
      !usableHeight(s.height)
    ) {
      refIndex.push(null)
      continue
    }
    const family = s.blockType
    refIndex.push(reference.length)
    reference.push({
      family,
      tone: designable.includes(family) ? sectionTone(s) : liveTone(family),
      height: Math.round(s.height)
    })
  }
  return {
    layout: {
      sections: sections.map((s) => s.blockType.slice(0, 40)),
      ...(email.angle ? { angle: email.angle.slice(0, 400) } : {})
    },
    reference,
    refIndex
  }
}

/**
 * The reference as the storyboard of a Copy plan keeps it: each planned
 * section's `ref` (from its `source`), and the tones a storyboard can keep
 * next to the planned neighbours (a stand-in or a dropped section changes
 * them): a dark hero beside a dark section, before or after, stands out as
 * accent instead, since two dark sections never touch.
 */
export function plannedReference(
  dna: {
    reference: NonNullable<StoryboardInput['reference']>
    refIndex: readonly (number | null)[]
  },
  sections: readonly { family: BlockType; source?: number }[]
): {
  reference: NonNullable<StoryboardInput['reference']>
  refs: (number | undefined)[]
} {
  const reference = dna.reference.map((r) => ({ ...r }))
  // A saved reference is read back from the build: an index it does not
  // hold follows nothing.
  const refs = sections.map((s) => {
    const r = s.source === undefined ? null : dna.refIndex[s.source]
    return typeof r === 'number' && r >= 0 && r < reference.length
      ? r
      : undefined
  })
  const toneAt = (i: number): Tone => {
    const r = refs[i]
    return designable.includes(sections[i].family) && r !== undefined
      ? reference[r].tone
      : liveTone(sections[i].family)
  }
  sections.forEach((s, i) => {
    const r = refs[i]
    if (r === undefined || !designable.includes(s.family)) return
    if (reference[r].tone !== 'dark') return
    const before = i > 0 && toneAt(i - 1) === 'dark'
    const after =
      i + 1 < sections.length &&
      !designable.includes(sections[i + 1].family) &&
      liveTone(sections[i + 1].family) === 'dark'
    if (before || after) reference[r].tone = 'accent'
  })
  return { reference, refs }
}

/** The fewest content sections a reference needs to be worth following. */
export const minContentSections = 2
/** How old a reference may be, in days. */
export const maxAgeDays = 366
const recentDays = 90
const dayMs = 86_400_000
/** An email a little after `now` (clocks differ) still counts. */
const skewMs = 5 * 60_000

/**
 * The inbox's email types (CI-001's labels) that count as the same kind as
 * a planned email: the planner and the labeller name kinds differently.
 */
export const sameKind: Record<EmailType, readonly InboxEmailType[]> = {
  restock: ['restock'],
  launch: ['launch', 'new_arrivals'],
  bestseller: ['bestsellers'],
  story: ['story'],
  education: ['education'],
  offer: ['sale', 'bundle'],
  'gift guide': ['gift_guide'],
  reminder: ['sale']
}

export type ReferencePick =
  { email: ReferenceEmail; reason: string } | { email: null; reason: string }

type Unfit = 'undated' | 'old' | 'thin' | 'heights'

/**
 * Why an email cannot be the reference in this mode, or null when it can.
 * Copy keeps each hero's height, so every hero must be measured within
 * what a designed section can keep; Remix needs only the order.
 */
function unfit(email: ReferenceEmail, mode: BuildMode, now: number) {
  const received = Date.parse(email.receivedAt)
  if (!Number.isFinite(received) || received > now + skewMs)
    return 'undated' satisfies Unfit
  if (now - received > maxAgeDays * dayMs) return 'old' satisfies Unfit
  const content = layoutOf(email.sections.map((s) => s.blockType)).filter(
    (b) => b !== 'unsure'
  )
  if (content.length < minContentSections) return 'thin' satisfies Unfit
  if (
    mode === 'copy' &&
    email.sections.some(
      (s) =>
        isBlockType(s.blockType) &&
        designable.includes(s.blockType) &&
        !keepable(s.height)
    )
  )
    return 'heights' satisfies Unfit
  return null
}

const industryWords: Record<string, string> = {
  food_drink: 'food and drink',
  beauty_tools: 'beauty tools'
}
const words = (v: string) => industryWords[v] ?? v.replace(/_/g, ' ')
const an = (v: string) => `${/^[aeiou]/i.test(v) ? 'an' : 'a'} ${v}`
const dateWords = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
})

const scratch = ', so this email is designed from scratch.'
const unfitWords: Record<Unfit, string> = {
  undated: 'their dates cannot be read',
  old: 'they are more than a year old',
  thin: 'their layouts are too short to follow',
  heights: 'their top pictures are too short or too tall to copy'
}

/**
 * The references for one slot, best first, among the inbox emails of
 * brands the workspace follows (or sample brands) that fit the mode: the
 * most labels shared with the slot first (its industry, its kind of
 * email), then a layout its brand keeps sending, then one sent in the last
 * 90 days, then the newest, then the id. An email that shares neither
 * label is never offered; an industry of "other", or none, is no match.
 * Each comes with its reason in the owner's words; when none fits,
 * `reason` says why the email is designed from scratch. Copy tries them in
 * order: code's storyboard of the whole email can still refuse one (the
 * pictures' share, the email's height), and the next is tried.
 */
export function rankReferences(
  emails: readonly ReferenceEmail[],
  slot: { industry: string | null; emailType: EmailType },
  {
    mode,
    now,
    followed
  }: { mode: BuildMode; now: number; followed: ReadonlySet<string> }
): { picks: { email: ReferenceEmail; reason: string }[]; reason: string } {
  if (mode === 'scratch')
    return { picks: [], reason: 'Scratch emails have no reference.' }
  const industry =
    slot.industry && slot.industry !== 'other' ? slot.industry : null
  const kinds = sameKind[slot.emailType] as readonly string[]
  const shown = emails.filter((e) => e.synthetic || followed.has(e.brandId))
  if (!shown.length)
    return {
      picks: [],
      reason: `No email from the brands you follow is in the Inspiration inbox yet${scratch}`
    }
  const sharing = shown
    .map((e) => ({
      e,
      sameIndustry: !!industry && e.industry === industry,
      sameType: kinds.includes(e.emailType ?? '')
    }))
    .filter((s) => s.sameIndustry || s.sameType)
  const labels = [
    industry ? `${an(words(industry))} email` : null,
    `${an(slot.emailType)} email`
  ]
    .filter(Boolean)
    .join(' or ')
  if (!sharing.length)
    return {
      picks: [],
      reason: `None of the emails from the brands you follow is ${labels}${scratch}`
    }
  const why = new Map<Unfit, number>()
  const fit = sharing.filter((s) => {
    const no = unfit(s.e, mode, now)
    if (no) why.set(no, (why.get(no) ?? 0) + 1)
    return !no
  })
  if (!fit.length) {
    const main = [...why.entries()].sort((a, b) => b[1] - a[1])[0][0]
    return {
      picks: [],
      reason: `The emails like it from the brands you follow cannot be followed: ${unfitWords[main]}${scratch}`
    }
  }
  const shares = (s: (typeof fit)[number]) =>
    (s.sameIndustry ? 1 : 0) + (s.sameType ? 1 : 0)
  const recent = (e: ReferenceEmail) =>
    now - Date.parse(e.receivedAt) <= recentDays * dayMs ? 1 : 0
  fit.sort(
    (a, b) =>
      shares(b) - shares(a) ||
      Number(b.e.winner) - Number(a.e.winner) ||
      recent(b.e) - recent(a.e) ||
      Date.parse(b.e.receivedAt) - Date.parse(a.e.receivedAt) ||
      (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0)
  )
  return {
    picks: fit.map((f) => {
      const shared = [
        f.sameIndustry && `the same industry (${words(industry!)})`,
        f.sameType && 'the same kind of email'
      ].filter(Boolean)
      const subject = oneLine(f.e.subject, 80) || 'an email'
      const brand = oneLine(f.e.brand, 60) || 'A brand you follow'
      return {
        email: f.e,
        reason: [
          `${mode === 'copy' ? 'We copy' : 'We remix'} ${brand}’s email “${subject}” (${dateWords.format(Date.parse(f.e.receivedAt))}). It is ${shared.join(' and ')}`,
          f.e.winner ? ', and a layout they send again and again' : '',
          '.'
        ].join('')
      }
    }),
    reason: ''
  }
}

/** The best reference for one slot (`rankReferences`), or why there is none. */
export function pickReference(
  ...args: Parameters<typeof rankReferences>
): ReferencePick {
  const { picks, reason } = rankReferences(...args)
  return picks[0] ?? { email: null, reason }
}
