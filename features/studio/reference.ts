import type { CompetitorLayout } from '@/features/assembly/modes'
import { isBlockType, type BlockType } from '@/features/blocks/catalog'
import type { BuildMode } from '@/features/email-build/sections'
import { layoutOf } from '@/features/inbox/winners'
import type { EmailType as InboxEmailType } from '@/features/intelligence/taxonomy'
import type { EmailType } from '@/features/strategy/plan'
import { liveTone, type StoryboardInput, type Tone } from './storyboard'

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
  /** One of the 20 families, `unsure`, or a footer. */
  blockType: string
  /** CSS px at 600 wide, from the email's screenshot; null when unknown. */
  height: number | null
  purpose?: string | null
  styles?: readonly string[]
}

/** An inbox email that could be the reference. */
export type ReferenceEmail = {
  id: string
  /** The sender brand's name, for the owner's words only. */
  brand: string
  subject: string
  industry: string | null
  emailType: string | null
  angle: string | null
  /** ISO time it reached the inbox. */
  receivedAt: string
  sections: readonly ReferenceSection[]
  /** Its layout is one its brand sends again and again (CMP-047). */
  winner: boolean
}

/**
 * A section's tone, as the storyboard counts it: dark when the inbox
 * tagged it dark, an offer stands out, else the tone its live block has.
 */
export function sectionTone(s: ReferenceSection): Tone {
  if (s.styles?.includes('dark')) return 'dark'
  if (s.purpose === 'offer') return 'accent'
  return isBlockType(s.blockType) ? liveTone(s.blockType) : 'light'
}

/** The tallest a reference section may be (a whole email is about 2,400). */
const maxSectionHeight = 4_000

const usableHeight = (h: number | null): h is number =>
  h !== null && Number.isFinite(h) && h > 0 && h <= maxSectionHeight

/**
 * What a build takes from its reference: the layout Copy follows and Remix
 * learns its structure from (sections in order, the angle as structure
 * only), the reference sections the Art director keeps to, and, for each
 * layout section, its place in that reference (null when it has none: an
 * unnamed part, a footer, an unknown height).
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
      isBlockType(s.blockType) &&
      s.blockType !== 'footer' &&
      usableHeight(s.height)
    ) {
      refIndex.push(reference.length)
      reference.push({
        family: s.blockType as BlockType,
        tone: sectionTone(s),
        height: Math.round(s.height)
      })
    } else refIndex.push(null)
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

/** The fewest content sections a reference needs to be worth following. */
export const minContentSections = 2
/** How old a reference may be, in days. */
export const maxAgeDays = 366
const recentDays = 90
const dayMs = 86_400_000

const weights = {
  industry: 3,
  emailType: 3,
  winner: 2,
  angle: 1,
  recent: 1
} as const

export type ReferencePick =
  | { email: ReferenceEmail; score: number; reason: string }
  | { email: null; reason: string }

const words = (v: string) => v.replace(/_/g, ' ')
const an = (v: string) => `${/^[aeiou]/i.test(v) ? 'an' : 'a'} ${words(v)}`

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
  reminder: ['sale', 'announcement']
}

/**
 * Why an email cannot be the reference in this mode, or null when it can.
 * Copy keeps every named section's height, so it needs them all; Remix
 * needs only the order.
 */
function unfit(email: ReferenceEmail, mode: BuildMode, now: number) {
  const received = Date.parse(email.receivedAt)
  if (!Number.isFinite(received) || received > now) return 'no date'
  if (now - received > maxAgeDays * dayMs) return 'too old'
  const content = layoutOf(email.sections.map((s) => s.blockType)).filter(
    (b) => b !== 'unsure'
  )
  if (content.length < minContentSections) return 'too few sections'
  if (
    mode === 'copy' &&
    email.sections.some(
      (s) =>
        isBlockType(s.blockType) &&
        s.blockType !== 'footer' &&
        !usableHeight(s.height)
    )
  )
    return 'heights unknown'
  return null
}

/**
 * The reference for one slot: among the inbox emails that fit the mode,
 * the one that shares most with the slot (industry and email type first,
 * then a layout its brand keeps sending, the angle, a recent send); ties
 * go to the newest, then the id. An email that shares neither the industry
 * nor the email type is never picked. Scratch has no reference.
 */
export function pickReference(
  emails: readonly ReferenceEmail[],
  slot: { industry: string; emailType: EmailType; angle?: string | null },
  { mode, now }: { mode: BuildMode; now: number }
): ReferencePick {
  if (mode === 'scratch')
    return { email: null, reason: 'Scratch emails have no reference.' }
  const scored = emails
    .filter((e) => unfit(e, mode, now) === null)
    .map((e) => {
      const industry = e.industry === slot.industry
      const emailType = (
        sameKind[slot.emailType] as readonly string[]
      ).includes(e.emailType ?? '')
      const angle = !!slot.angle && e.angle === slot.angle
      const recent = now - Date.parse(e.receivedAt) <= recentDays * dayMs
      return {
        e,
        industry,
        emailType,
        angle,
        score:
          (industry ? weights.industry : 0) +
          (emailType ? weights.emailType : 0) +
          (e.winner ? weights.winner : 0) +
          (angle ? weights.angle : 0) +
          (recent ? weights.recent : 0)
      }
    })
    .filter((s) => s.industry || s.emailType)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(b.e.receivedAt) - Date.parse(a.e.receivedAt) ||
        (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0)
    )
  const best = scored[0]
  if (!best)
    return {
      email: null,
      reason: `No email in the Inspiration inbox is ${an(slot.industry)} email or ${an(slot.emailType)} email ${mode === 'copy' ? 'with every section measured' : 'with a clear layout'}, so this email is designed from scratch.`
    }
  const shared = [
    best.industry && `the same industry (${words(slot.industry)})`,
    best.emailType && `the same kind of email (${words(slot.emailType)})`
  ].filter(Boolean)
  const date = new Date(Date.parse(best.e.receivedAt))
    .toISOString()
    .slice(0, 10)
  return {
    email: best.e,
    score: best.score,
    reason: [
      `${best.e.brand}’s email “${best.e.subject}” (${date}): ${shared.join(' and ')}`,
      best.e.winner ? ', a layout they keep sending' : '',
      best.angle ? ', the same angle' : '',
      '.'
    ].join('')
  }
}
