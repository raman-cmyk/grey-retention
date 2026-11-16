import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { OfferSource } from '@/features/offers/source'
import {
  codeWorksNow,
  contentStep,
  shownOffer,
  copyStep,
  designStep,
  sectionsStep,
  type BuildCtx,
  type BuiltEmail,
  type CopyOutput,
  type PlannedEmail,
  type SectionsOutput
} from './build'
import type { LockedContent } from './content'
import {
  studioDesignStep,
  type StudioStepPorts
} from '@/features/studio/design-step'
import { clip, keyPart } from '@/features/fallback/entry'
import { hardProblems } from './hard-checks'
import type { Store } from './ports'
import { buildSteps, type BuildStep, type RoundStep } from './step-names'

/**
 * REL-081: the build steps of "Create email" (`buildSteps`, the push
 * follows). The job runs one step per claim and saves its output
 * (`finish_email_step`), so a step that fails is tried again on its own,
 * from the saved steps before it.
 */
export { buildSteps, type BuildStep }

/**
 * Each step must end well under a minute (the job's time limit). The
 * code-only steps take milliseconds; a step over this is logged, and the
 * agents bring their own time limit when they take over.
 */
export const stepBudgetMs = 50_000

// Light checks of the saved outputs. They are this code's own, but a
// deploy between two steps may change their shape: a saved step that no
// longer reads fails the build with its reason, and "Try again" starts
// over with fresh store data.
const sectionsSaved = z.looseObject({
  sendAt: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1),
  sample: z.boolean(),
  store: z.string().optional(),
  rules: z.looseObject({
    maxDiscountPercent: z.number().min(0).max(100),
    codes: z
      .array(
        z.looseObject({
          code: z.string(),
          percent: z.number(),
          expiresAt: z.string().nullable()
        })
      )
      .max(200)
  }),
  layout: z.looseObject({
    sections: z
      .array(
        z.looseObject({
          family: z.string(),
          variantId: z.string(),
          purpose: z.string()
        })
      )
      .max(30)
  })
})
const contentSaved = z.looseObject({
  sections: z
    .array(z.looseObject({ family: z.string(), purpose: z.string() }))
    .max(30),
  input: z.looseObject({
    products: z.array(z.looseObject({ id: z.string() })),
    codes: z.array(z.looseObject({ code: z.string() })),
    maxDiscountPercent: z.number(),
    sendAt: z.string(),
    timezone: z.string(),
    // ONB-061: the customers' words (REL-CW); missing before it.
    customerWords: z.array(z.string()).max(40).optional()
  }),
  changes: z.array(z.looseObject({ key: z.string() }))
})
const copySaved = z.looseObject({
  draft: z.looseObject({
    subject: z.string(),
    preheader: z.string(),
    blocks: z.array(z.unknown()).min(1),
    productIds: z.array(z.string()),
    code: z.string().nullable()
  }),
  changes: z.array(z.string()).max(40),
  written: z.boolean().optional()
})
/** A step's saved rounds (REL-AI part 2b), read by the step itself. */
const roundsOf = (progress: Record<string, unknown>, step: string) => {
  const work = progress.work
  const mine =
    work && typeof work === 'object'
      ? (work as Record<string, unknown>)[step]
      : undefined
  if (!mine || typeof mine !== 'object') return { work: undefined, saves: 0 }
  const saves = (mine as { saves?: unknown }).saves
  return {
    work: mine,
    saves: typeof saves === 'number' && Number.isInteger(saves) ? saves : 0
  }
}
const progressSaved = z.looseObject({})

export type StepResult =
  | { ok: true; done: Exclude<BuildStep, 'design'>; output: object }
  | { ok: true; done: 'design'; email: BuiltEmail }
  /**
   * REL-AI part 2b: the step ran what fitted in its time and saves its
   * rounds so far; the next claim goes on from them.
   */
  | { ok: true; saved: RoundStep; work: object }
  /**
   * DST-006b: the design step asked for its sections to be drawn and waits
   * for the pictures, at most `seconds` (then the sweep draws coded
   * blocks); the design studio's job claims it again when they are there.
   */
  | { ok: true; waiting: 'design'; work: object; seconds: number }
  | {
      ok: false
      /**
       * Short codes for the build's error column; all final but
       * `step_unknown` (an app newer than its database) and
       * `offers_unreadable`, tried again.
       */
      code:
        | 'slot_time_invalid'
        | 'send_time_passed'
        | 'offers_unreadable'
        | 'subject_taken'
        | 'copy_failed'
        | 'render_failed'
        | 'offer_unsafe'
        | 'step_progress_invalid'
        | 'step_unknown'
        | 'store_changed'
        | 'hard_check_failed'
    }

const unreadable = { ok: false, code: 'step_progress_invalid' } as const

/** JSON with every object's keys in order: the same data, the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`
      )
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/**
 * REL-STO: what the build's steps read from the store, as one short hash:
 * the brand, the industry, the facts and the products (in id order, so a
 * read that lists them in another order is the same store). Left out: the
 * timezone and the customers' words, since later steps use the ones the
 * steps before saved. A catalog read again between two steps with other
 * products, prices or pictures gives another hash.
 */
export function storeFingerprint(store: Store) {
  const products = [...store.products].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  )
  return createHash('sha256')
    .update(
      canonical({
        sample: store.sample,
        brand: store.brand,
        industry: store.industry,
        facts: store.facts,
        products
      })
    )
    .digest('hex')
    .slice(0, 32)
}

/**
 * Runs one build step from the steps saved before it. The store is read
 * fresh for each step; the send time, offer rules and timezone are the
 * ones the first step saved, so an email never mixes two versions of
 * Settings, and a store that changed between sample and real data starts
 * over ("Try again"), as does one read again with other data since the
 * first step (REL-STO, `storeFingerprint`). Never throws for bad data.
 */
export async function runBuildStep(
  step: string,
  input: {
    planned: PlannedEmail
    store: Store
    offers: OfferSource
    progress: unknown
    /** The copy step: subjects the plan's other emails use (REL-AI). */
    taken?: readonly string[]
  },
  ctx: BuildCtx & {
    /**
     * DST-006c: the design studio's ports for this claim, only with the
     * owner's switch on and the agents (the worker gives them); without,
     * the design step draws coded blocks.
     */
    studio?: StudioStepPorts
    /** DST-006e: the owner's studio is on but this claim cannot run it. */
    studioSkipped?: boolean
  }
): Promise<StepResult> {
  if (!(buildSteps as readonly string[]).includes(step))
    return { ok: false, code: 'step_unknown' }
  const progress = progressSaved.safeParse(input.progress)
  if (!progress.success) return unreadable
  const { planned, store } = input
  if (step === 'sections') {
    const made = await sectionsStep(input, ctx)
    return made.ok
      ? {
          ok: true,
          done: 'sections',
          output: { ...made.output, store: storeFingerprint(store) }
        }
      : made
  }
  const parsed = sectionsSaved.safeParse(progress.data.sections)
  if (!parsed.success) return unreadable
  const sections = parsed.data as unknown as SectionsOutput
  // REL-STO: the same store as the first step read, or start over.
  if (
    sections.sample !== store.sample ||
    (sections.store !== undefined && sections.store !== storeFingerprint(store))
  )
    return { ok: false, code: 'store_changed' }
  if (step === 'content')
    return {
      ok: true,
      done: 'content',
      output: await contentStep({ planned, store, sections }, ctx)
    }
  if (step === 'copy') {
    const locked = contentSaved.safeParse(progress.data.content)
    if (!locked.success) return unreadable
    const rounds = roundsOf(progress.data, 'copy')
    const made = await copyStep(
      {
        store,
        locked: locked.data as unknown as LockedContent,
        taken: input.taken,
        work: rounds.work,
        saves: rounds.saves
      },
      ctx
    )
    if (!made.ok) return made
    return 'work' in made
      ? { ok: true, saved: 'copy', work: made.work }
      : { ok: true, done: 'copy', output: made.output }
  }
  const copy = copySaved.safeParse(progress.data.copy)
  if (!copy.success) return unreadable
  const content = progress.data.content as { source?: unknown } | undefined
  // REL-OFF: the code also works with Settings now (switched off, or the
  // max lowered, since the first step); `designStep` checks what is drawn.
  const code = (copy.data as unknown as CopyOutput).draft.code
  if (code !== null) {
    const now = await codeWorksNow(
      code,
      input.offers,
      ctx.tenantId,
      sections.sendAt,
      shownOffer(code, sections.rules)
    )
    if (now === 'unreadable') return { ok: false, code: 'offers_unreadable' }
    if (now === 'unsafe') return { ok: false, code: 'offer_unsafe' }
  }
  const plain = copy.data as unknown as CopyOutput
  let drawn = plain
  const saved = roundsOf(progress.data, 'design').work as
    { studio?: unknown } | undefined
  if (ctx.studio) {
    // DST-006c: the designed heroes from the studio, the rest coded.
    const locked = (progress.data.content as LockedContent | undefined)
      ?.sections
    const studio = await studioDesignStep(
      {
        slot: { emailType: planned.emailType, angle: planned.angle },
        sections: (locked ?? []).map((s) => ({
          family: s.family,
          purpose: s.purpose,
          products: (Array.isArray(s.products) ? s.products : []).flatMap(
            (p) => (typeof p?.title === 'string' ? [{ title: p.title }] : [])
          )
        })),
        blocks: drawn.draft.blocks,
        brand: store.brand,
        saved
      },
      ctx.studio
    )
    if ('waiting' in studio)
      return {
        ok: true,
        waiting: 'design',
        work: studio.waiting.work,
        seconds: studio.waiting.seconds
      }
    drawn = { ...drawn, draft: { ...drawn.draft, blocks: studio.blocks } }
  }
  // The studio's work without its ports (its time up, the switch turned
  // off, or a try that threw), or the studio on with no agents for this
  // claim: drawn coded, and the owner's log says so once (D16), after the
  // email is drawn.
  const coded =
    !ctx.studio && saved?.studio
      ? {
          reasonCode: 'studio_not_finished',
          reason: 'The design studio stopped before it finished.',
          key: 'not-finished'
        }
      : !ctx.studio && ctx.studioSkipped
        ? {
            reasonCode: 'studio_no_time',
            reason: 'The design studio had no time left for this email.',
            key: 'no-time'
          }
        : null
  const draw = (from: CopyOutput) =>
    designStep({
      planned,
      store,
      sendAt: sections.sendAt,
      sample: sections.sample,
      copy: from,
      rules: sections.rules,
      ai: sections.layout.source === 'agent' || content?.source === 'agent'
    })
  // DST-005: the hard checks on the email as drawn, before it is stored.
  const hostOf = (url: string | undefined) => {
    try {
      return url ? [new URL(url).hostname.toLowerCase()] : []
    } catch {
      return []
    }
  }
  const checksOf = (html: string) =>
    hardProblems(html, {
      maxDiscountPercent: sections.rules.maxDiscountPercent,
      known: [
        store.brand.name,
        ...store.products.map((p) => p.title),
        ...store.facts.approvedClaims
      ],
      storeHosts: [
        ...new Set([
          ...hostOf(store.brand.site),
          ...store.products.flatMap((p) => hostOf(p.url))
        ])
      ]
    })
  let made = draw(drawn)
  let problems = made.ok ? checksOf(made.email.html) : []
  const pictured = drawn.draft.blocks.some(
    (b) => (b.content as { picture?: unknown }).picture
  )
  if (made.ok && problems.length && pictured) {
    // The studio's email failed one: its coded blocks instead (D16),
    // logged once they pass.
    const failed = problems
    made = draw(plain)
    problems = made.ok ? checksOf(made.email.html) : []
    if (made.ok && !problems.length)
      await ctx.fallbacks.record({
        tenantId: ctx.tenantId,
        campaignId: ctx.campaignId ?? null,
        agent: 'email-checks',
        reasonCode: `hard_check_${failed[0]!.check}`,
        reason: failed[0]!.problem,
        fallback: 'Drew the email with its coded blocks.',
        attempts: 1,
        detail: { checks: failed.map((p) => p.check) },
        dedupeKey: `email-checks:${keyPart(ctx.callerKey)}:studio`
      })
  }
  if (made.ok && problems.length) {
    await ctx.fallbacks.record({
      tenantId: ctx.tenantId,
      campaignId: ctx.campaignId ?? null,
      agent: 'email-checks',
      reasonCode: `hard_check_${problems[0]!.check}`,
      reason: clip(problems.map((p) => p.problem).join(' '), 500),
      fallback: 'No email was stored; trying again makes it again.',
      attempts: 1,
      detail: { checks: problems.map((p) => p.check) },
      dedupeKey: `email-checks:${keyPart(ctx.callerKey)}:coded`
    })
    return { ok: false, code: 'hard_check_failed' }
  }
  if (made.ok && coded)
    await ctx.fallbacks.record({
      tenantId: ctx.tenantId,
      campaignId: ctx.campaignId ?? null,
      agent: 'design-studio',
      reasonCode: coded.reasonCode,
      reason: coded.reason,
      fallback: 'Drew the email with its coded blocks.',
      attempts: 1,
      detail: {},
      dedupeKey: `design-studio:${keyPart(ctx.callerKey)}:${coded.key}`
    })
  return made.ok ? { ok: true, done: 'design', email: made.email } : made
}
