import { z } from 'zod'
import type { OfferSource } from '@/features/offers/source'
import {
  contentStep,
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
    timezone: z.string()
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
  | {
      ok: false
      /**
       * Short codes for the build's error column; all final but
       * `step_unknown` (an app newer than its database),
       * `offers_unreadable` and `ai_unavailable` (the AI was busy; it may
       * say how long to wait), tried again.
       */
      code:
        | 'slot_time_invalid'
        | 'offers_unreadable'
        | 'subject_taken'
        | 'copy_failed'
        | 'ai_unavailable'
        | 'render_failed'
        | 'step_progress_invalid'
        | 'step_unknown'
        | 'store_changed'
      retryAfterSeconds?: number
    }

const unreadable = { ok: false, code: 'step_progress_invalid' } as const

/**
 * Runs one build step from the steps saved before it. The store is read
 * fresh for each step; the send time, offer rules and timezone are the
 * ones the first step saved, so an email never mixes two versions of
 * Settings, and a store that changed between sample and real data starts
 * over ("Try again"). Never throws for bad data.
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
  ctx: BuildCtx
): Promise<StepResult> {
  if (!(buildSteps as readonly string[]).includes(step))
    return { ok: false, code: 'step_unknown' }
  const progress = progressSaved.safeParse(input.progress)
  if (!progress.success) return unreadable
  const { planned, store } = input
  if (step === 'sections') {
    const made = await sectionsStep(input, ctx)
    return made.ok ? { ok: true, done: 'sections', output: made.output } : made
  }
  const parsed = sectionsSaved.safeParse(progress.data.sections)
  if (!parsed.success) return unreadable
  const sections = parsed.data as unknown as SectionsOutput
  if (sections.sample !== store.sample)
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
  const made = designStep({
    planned,
    store,
    sendAt: sections.sendAt,
    sample: sections.sample,
    copy: copy.data as unknown as CopyOutput,
    ai: sections.layout.source === 'agent' || content?.source === 'agent'
  })
  return made.ok ? { ok: true, done: 'design', email: made.email } : made
}
