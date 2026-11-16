import { eligibleProducts } from '@/features/assembly/inputs'
import { keyPart } from '@/features/fallback/entry'
import {
  letterHtmlProblems,
  type LetterProblem
} from '@/features/letter/checks'
import { letterSchema, type Letter } from '@/features/letter/letter'
import { renderLetter } from '@/features/letter/render'
import { kindFits, type LetterKind } from '@/features/letter/kinds'
import {
  letterFindings,
  plainLetter,
  theTitle,
  writeLetter,
  type LetterBrief
} from '@/features/letter/writer'
import { agentCallMs } from './step-names'
import type { ChangeKey, LockedContent } from './content'
import type { SectionPlan } from './sections'
import type { Store } from './ports'
import {
  callSlackMs,
  shownOffer,
  subjectKey,
  subjectText,
  type BuildCtx,
  type BuildResult,
  type PlannedEmail,
  type SectionsOutput
} from './build'

/**
 * TXT-001c (D26): "Create email" builds a text email, a short personal
 * letter, when the slot's format is `text`. It keeps the build's steps:
 * the first (the send time, the offer rules then) and the second (the
 * Content locker locks the lead product and the offer, with every check a
 * designed email has); it skips the Section planner (AGENT_MAP §4: text
 * emails skip layer 1) and the design studio. The copy step writes the
 * letter (the Letter writer with the agents, else the plain letter), the
 * design step draws it as a person's email with a real plain-text part,
 * and, in the job's saved steps (TXT-001d), the hard checks (width,
 * weight, links, the offer within the max) judge it as every email.
 */

/** A text email's sections: only what the Content locker must lock. */
export function letterLayout(planned: PlannedEmail): SectionPlan {
  return {
    mode: 'scratch',
    dropped: [],
    source: 'code',
    sections: [
      ...(planned.products.length
        ? [
            {
              family: 'product_feature' as const,
              variantId: 'product_feature/seed',
              purpose: 'The product the letter links to.'
            }
          ]
        : []),
      ...(planned.offer
        ? [
            {
              family: 'offer_banner' as const,
              variantId: 'offer_banner/seed',
              purpose: 'The offer the letter gives, on its own line.'
            }
          ]
        : [])
    ]
  }
}

export type LetterCopy = {
  letter: Letter
  /** The product the letter links to (none, or the lead one). */
  productIds: string[]
  changes: ChangeKey[]
  /** The Letter writer's words passed every check. */
  written?: boolean
}

/** The letter's brief from the locked content. */
const briefOf = (
  store: Store,
  locked: LockedContent,
  kind?: LetterKind
): LetterBrief => ({
  locked,
  brandName: store.brand.name,
  site: store.brand.site,
  ...(kind ? { kind } : {})
})

/** Why a planned kind became no kind, in the owner's words (DST-PIC #24). */
const kindDropped = {
  kind_needs_founder_note:
    'The planned founder note had no founder’s note it could use (one confirmed, short, and passing the checks).',
  kind_never_offers:
    'The planned kind of letter never carries an offer, and this email has one.'
} as const

/** The plain letter's subjects, in order: facts only, never a claim. */
function plainSubjects(store: Store, locked: LockedContent, letter: Letter) {
  const lead = eligibleProducts(locked.input)[0]
  const brand = subjectText(store.brand.name)
  const title = lead ? subjectText(lead.title) : null
  return [
    letter.subject,
    ...(title ? [`A short note about ${theTitle(title)}`] : []),
    ...(brand
      ? [`A short note from ${brand}`, `A note from all of us at ${brand}`]
      : []),
    'A short note from us',
    'Something we wanted to share'
  ].filter((s, i, all) => s.length <= 60 && all.indexOf(s) === i)
}

/** Step 3 of a text email: the letter, written or plain. */
export async function letterCopyStep(
  input: {
    store: Store
    locked: LockedContent
    /** Subjects the plan's other emails use (REL-AI). */
    taken?: readonly string[]
    /** DST-PIC #24: the planned kind of letter. */
    kind?: LetterKind
  },
  ctx: BuildCtx
): Promise<
  | { ok: true; output: LetterCopy }
  | { ok: false; code: 'copy_failed' | 'subject_taken' }
> {
  const { store, locked } = input
  const brief = briefOf(store, locked, input.kind)
  // A planned kind that does not fit is a short letter of no kind, logged
  // (only the Letter writer reads a kind).
  const unfit = input.kind && ctx.agents ? kindFits(input.kind, brief) : null
  if (unfit)
    await ctx.fallbacks.record({
      tenantId: ctx.tenantId,
      campaignId: ctx.campaignId ?? null,
      agent: 'letter-writer',
      reasonCode: 'letter_kind_dropped',
      reason: kindDropped[unfit],
      fallback: 'Wrote a short letter of no kind instead.',
      attempts: 1,
      detail: { kind: input.kind ?? null, why: unfit },
      dedupeKey: `letter-writer:kind:${keyPart(ctx.callerKey)}`
    })
  const taken = new Set((input.taken ?? []).map(subjectKey))
  const changes = [
    ...new Set(locked.changes.map((c): ChangeKey => c.key))
  ].slice(0, 40)
  const lead = eligibleProducts(locked.input)[0]
  const productIds = lead ? [lead.id] : []
  const takenProblem = (letter: Letter): LetterProblem[] =>
    taken.has(subjectKey(letter.subject))
      ? [
          {
            rule: 'subject_taken',
            reason:
              'Another email in this plan already has this subject: write a different one.'
          }
        ]
      : []
  let plain: Letter
  if (ctx.agents) {
    const now = ctx.clock ?? Date.now
    const until = ctx.until
    const made = await writeLetter(
      brief,
      {
        tenantId: ctx.tenantId,
        industry: store.industry,
        callerKey: ctx.callerKey,
        campaignId: ctx.campaignId ?? null,
        memory: ctx.agents.memory,
        log: ctx.agents.log,
        ai: ctx.agents.ai,
        fallbacks: ctx.fallbacks,
        ...(until !== undefined
          ? { fits: () => now() + agentCallMs + callSlackMs <= until }
          : {})
      },
      takenProblem
    )
    if (made.status === 'written')
      return {
        ok: true,
        output: { letter: made.letter, productIds, changes, written: true }
      }
    if (made.status === 'failed') return { ok: false, code: 'copy_failed' }
    plain = made.letter
  } else {
    plain = plainLetter(brief)
    const rules = [...new Set(letterFindings(plain, brief).map((f) => f.rule))]
    if (rules.length) {
      await ctx.fallbacks.record({
        tenantId: ctx.tenantId,
        campaignId: ctx.campaignId ?? null,
        agent: 'email-build',
        reasonCode: 'copy_failed',
        reason: `The plain letter failed the code checks: ${rules.join(', ').replace(/_/g, ' ')}.`,
        fallback: 'No email was built; the owner can create it again.',
        attempts: 1,
        detail: { rules: rules.slice(0, 20) },
        dedupeKey: `email-build:${keyPart(ctx.callerKey)}`
      })
      return { ok: false, code: 'copy_failed' }
    }
  }
  // The plain letter's subject made free (REL-AI), still passing its checks.
  const free = plainSubjects(store, locked, plain)
    .map((subject) => ({ ...plain, subject }))
    .find(
      (l) =>
        !taken.has(subjectKey(l.subject)) &&
        letterSchema.safeParse(l).success &&
        !letterFindings(l, brief).length
    )
  if (!free) {
    await ctx.fallbacks.record({
      tenantId: ctx.tenantId,
      campaignId: ctx.campaignId ?? null,
      agent: 'email-build',
      reasonCode: 'subject_taken',
      reason:
        'Every subject it could use is used by another email in this plan.',
      fallback: 'No email was built; planning again gives new emails.',
      attempts: 1,
      detail: { taken: Math.min(input.taken?.length ?? 0, 40) },
      dedupeKey: `email-build:subject:${keyPart(ctx.callerKey)}`
    })
    return { ok: false, code: 'subject_taken' }
  }
  return { ok: true, output: { letter: free, productIds, changes } }
}

/** The offer a letter shows is exactly a working code within the max (REL-OFF). */
export function letterOfferShown(
  letter: Letter,
  rules: SectionsOutput['rules'],
  sendAt: string
) {
  if (!letter.offer) return true
  const key = letter.offer.code.trim().toUpperCase()
  const found = rules.codes.find((c) => c.code.trim().toUpperCase() === key)
  return (
    !!found &&
    found.percent === letter.offer.percent &&
    found.percent <= rules.maxDiscountPercent &&
    (found.expiresAt === null ||
      Date.parse(found.expiresAt) > Date.parse(sendAt))
  )
}

/** Step 4 of a text email: the letter drawn, its HTML and its plain text. */
export function letterDesignStep(input: {
  planned: PlannedEmail
  store: Store
  sendAt: string
  sample: boolean
  copy: LetterCopy
  rules: SectionsOutput['rules']
  /** An agent made part of it: the screen says so. */
  ai?: boolean
  name: string
}): BuildResult {
  const { store, copy } = input
  const { letter } = copy
  if (!letterOfferShown(letter, input.rules, input.sendAt))
    return { ok: false, code: 'offer_unsafe' }
  const logo = !!store.brand.logo
  let drawn: { html: string; text: string }
  try {
    drawn = renderLetter(letter, { brand: store.brand, mode: 'klaviyo', logo })
  } catch {
    return { ok: false, code: 'render_failed' }
  }
  if (letterHtmlProblems(drawn.html, { logo }).length)
    return { ok: false, code: 'render_failed' }
  const code = letter.offer?.code ?? null
  return {
    ok: true,
    email: {
      sample: input.sample,
      ai: (input.ai ?? false) || copy.written === true,
      name: input.name,
      subject: letter.subject,
      preheader: letter.preheader,
      html: drawn.html,
      text: drawn.text,
      format: 'text',
      approach: 'A',
      copy: copy.written ? 'written' : 'plain',
      plannedSendAt: input.sendAt,
      audienceId: input.planned.audience.id,
      productIds: copy.productIds,
      code,
      offer: shownOffer(code, input.rules),
      changes: copy.changes
    }
  }
}
