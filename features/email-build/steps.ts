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
import { buildSteps, type BuildStep } from './step-names'

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
  changes: z.array(z.string()).max(40)
})
const progressSaved = z.looseObject({})

export type StepResult =
  | { ok: true; done: Exclude<BuildStep, 'design'>; output: object }
  | { ok: true; done: 'design'; email: BuiltEmail }
  | {
      ok: false
      /** Short codes for the build's error column; all final. */
      code:
        | 'slot_time_invalid'
        | 'copy_failed'
        | 'render_failed'
        | 'step_progress_invalid'
        | 'step_unknown'
        | 'store_changed'
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
    const made = await copyStep(
      { store, locked: locked.data as unknown as LockedContent },
      ctx
    )
    return made.ok ? { ok: true, done: 'copy', output: made.output } : made
  }
  const copy = copySaved.safeParse(progress.data.copy)
  if (!copy.success) return unreadable
  const made = designStep({
    planned,
    store,
    sendAt: sections.sendAt,
    sample: sections.sample,
    copy: copy.data as unknown as CopyOutput
  })
  return made.ok ? { ok: true, done: 'design', email: made.email } : made
}
