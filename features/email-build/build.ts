import { z } from 'zod'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import type { FallbackLog } from '@/features/fallback/log'
import { keyPart } from '@/features/fallback/entry'
import {
  allowedBlockTypes,
  type AssemblyInput
} from '@/features/assembly/inputs'
import { assembleLockedPlain } from '@/features/assembly/modes'
import { localTimeCandidates } from '@/lib/local-time'
import { codeSectionPlan, seedVariants, type SectionPlan } from './sections'
import { lockContent, type ChangeKey, type LockedContent } from './content'
import { codeFindings } from './inspect'
import { designA } from './design'
import type { Draft } from '@/features/assembly/assemble'
import type { DiscountCode, OfferSource } from '@/features/offers/source'
import { offersAt, type Store } from './ports'

/**
 * EML-004 part 2: one planned email, built from start to finish. This part
 * is the code-only path (like STR-003 part 2's plan): the safe section
 * layout, products placed in plan order, plain facts-only copy that must
 * pass every code check, and coded blocks (approach A). No AI is called.
 * The agents (EML-001..004) take over once live AI is switched on with the
 * owner's OK and the job has its own time limit and a longer lease.
 */

/** The planned email this build is for (a slot of STR-003's stored plan). */
export const plannedEmail = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  emailType: z.enum([
    'launch',
    'bestseller',
    'offer',
    'story',
    'gift guide',
    'restock',
    'reminder',
    'education'
  ]),
  angle: z.string().min(1).max(600),
  products: z.array(z.object({ id: z.string(), title: z.string() })).max(6),
  offer: z
    .object({ id: z.string(), code: z.string(), percent: z.number() })
    .nullable(),
  audience: z.object({ id: z.string(), label: z.string() })
})
export type PlannedEmail = z.infer<typeof plannedEmail>

/** What the build stores and the pusher puts into Klaviyo. */
export const builtEmail = z.object({
  /** Built from the sample store: the screen says so. */
  sample: z.boolean(),
  /** False on the code-only path: the screen says the AI was not used. */
  ai: z.boolean(),
  name: z.string().min(1).max(120),
  subject: z.string().min(1).max(120),
  preheader: z.string().max(200),
  html: z.string().min(1).max(200_000),
  approach: z.enum(['A', 'B']),
  copy: z.enum(['written', 'plain']),
  plannedSendAt: z.string(),
  audienceId: z.string(),
  productIds: z.array(z.string()).max(12),
  code: z.string().nullable(),
  /** Planned content the Content locker replaced with safer choices. */
  changes: z.array(z.string()).max(40)
})
export type BuiltEmail = z.infer<typeof builtEmail>

export type BuildResult =
  | { ok: true; email: BuiltEmail }
  | {
      ok: false
      /** Short codes for the build's error column; all final. */
      code: 'slot_time_invalid' | 'copy_failed' | 'render_failed'
    }

/** No AI on the code-only path: any agent call would be a bug. */
const noAi: AiCall = async () => ({ ok: false, code: 'setup_required' })

const dayName = (date: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00Z`))

const typeName = (type: PlannedEmail['emailType']) =>
  type.charAt(0).toUpperCase() + type.slice(1)

/**
 * REL-081: "Create email" runs as saved steps, each its own short job:
 * sections, content, copy, design (then the push). Each step's output is
 * saved before the next starts, so a failed step is tried again on its
 * own, from the saved steps before it. All outputs are plain JSON.
 */
export type SectionsOutput = {
  /** The planned local time, as an instant. */
  sendAt: string
  /** The workspace's timezone then: every later step shows dates in it. */
  timezone: string
  /** Built from the sample store: a later step on real data starts over. */
  sample: boolean
  /** DSC-001: the max and the codes still working when this email sends. */
  rules: { maxDiscountPercent: number; codes: DiscountCode[] }
  layout: SectionPlan
}
export type CopyOutput = { draft: Draft; changes: ChangeKey[] }

type StepInput = { planned: PlannedEmail; store: Store }

/** What the Content locker and the copy write into, from the saved rules. */
const assemblyFor = (
  store: Store,
  saved: Pick<SectionsOutput, 'sendAt' | 'rules' | 'timezone'>
): Omit<AssemblyInput, 'brief'> => ({
  products: store.products,
  codes: saved.rules.codes,
  maxDiscountPercent: saved.rules.maxDiscountPercent,
  sendAt: saved.sendAt,
  timezone: saved.timezone,
  facts: store.facts
})

/** Step 1: the send time, the offer rules at that time, and the sections. */
export async function sectionsStep(
  input: StepInput & { offers: OfferSource },
  ctx: BuildCtx
): Promise<
  | { ok: true; output: SectionsOutput }
  | { ok: false; code: 'slot_time_invalid' }
> {
  const { planned, store, offers } = input
  // The planned local time, as an instant (the earlier one on a DST fold).
  const sendAt = localTimeCandidates(
    `${planned.date}T${planned.time}`,
    store.timezone
  )[0]
  if (!sendAt) return { ok: false, code: 'slot_time_invalid' }
  const read = await offersAt(offers, ctx.tenantId, sendAt)
  const rules = {
    maxDiscountPercent: read.maxDiscountPercent,
    codes: [...read.codes]
  }
  const allowed = allowedBlockTypes({
    ...assemblyFor(store, { sendAt, rules, timezone: store.timezone }),
    brief: {
      campaignType: planned.emailType,
      goal: planned.angle,
      ...(planned.offer ? { offerCode: planned.offer.code } : {})
    }
  })
  const layout = codeSectionPlan({
    mode: 'scratch',
    industry: store.industry,
    slot: {
      emailType: planned.emailType,
      angle: planned.angle,
      products: planned.products.length,
      offer: !!planned.offer
    },
    allowed,
    library: seedVariants
  })
  return {
    ok: true,
    output: {
      sendAt,
      timezone: store.timezone,
      sample: store.sample,
      rules,
      layout
    }
  }
}

/** Step 2: products, prices, the offer, its code, pictures and links locked. */
export async function contentStep(
  input: StepInput & { sections: SectionsOutput },
  ctx: BuildCtx
): Promise<LockedContent> {
  const { planned, store, sections } = input
  return lockContent(
    {
      slot: planned,
      sections: sections.layout,
      store: assemblyFor(store, sections),
      site: store.brand.site
    },
    {
      ...ctx,
      agent: false,
      memory: new InMemoryMemoryStore(),
      log: new InMemoryRunLog(),
      ai: noAi
    }
  )
}

/** Step 3: plain facts-only copy that must pass every code check. */
export async function copyStep(
  input: { store: Store; locked: LockedContent },
  ctx: BuildCtx
): Promise<
  { ok: true; output: CopyOutput } | { ok: false; code: 'copy_failed' }
> {
  const { store, locked } = input
  const steps = locked.sections.map((s) => ({
    type: s.family,
    reason: s.purpose
  }))
  const plain = assembleLockedPlain(locked.input, store.brand, steps)
  const findings =
    plain.status === 'sample'
      ? []
      : codeFindings(plain, locked, store.brand.name)
  if (plain.status !== 'ready' || findings.length) {
    await ctx.fallbacks.record({
      tenantId: ctx.tenantId,
      campaignId: ctx.campaignId ?? null,
      agent: 'email-build',
      reasonCode: 'copy_failed',
      reason: `Plain copy failed the code checks: ${[...new Set(findings.map((f) => f.rule))].join(', ').replace(/_/g, ' ') || 'the email could not be assembled'}.`,
      fallback: 'No email was built; the owner can create it again.',
      attempts: 1,
      detail: {
        rules: [...new Set(findings.map((f) => f.rule))].slice(0, 20)
      },
      dedupeKey: `email-build:${keyPart(ctx.callerKey)}`
    })
    return { ok: false, code: 'copy_failed' }
  }
  return {
    ok: true,
    output: {
      draft: plain.draft,
      changes: [...new Set(locked.changes.map((c): ChangeKey => c.key))].slice(
        0,
        40
      )
    }
  }
}

/** Step 4: the copy drawn with coded design A, as the email to store. */
export function designStep(
  input: StepInput & { sendAt: string; sample: boolean; copy: CopyOutput }
): BuildResult {
  const { planned, store, sendAt, sample, copy } = input
  const { draft } = copy
  let html: string
  try {
    html = designA(draft, store.brand).html
  } catch {
    return { ok: false, code: 'render_failed' }
  }
  return {
    ok: true,
    email: {
      sample,
      ai: false,
      name: `${dayName(planned.date)} · ${typeName(planned.emailType)}`,
      subject: draft.subject,
      preheader: draft.preheader,
      html,
      approach: 'A',
      copy: 'plain',
      plannedSendAt: sendAt,
      audienceId: planned.audience.id,
      productIds: draft.productIds,
      code: draft.code,
      changes: copy.changes
    }
  }
}

/**
 * The locked draft of one planned email on the code-only path: the first
 * three steps at once, before any drawing. The A-vs-B test (EML-005) draws
 * the same draft both ways. Never throws for bad data.
 */
export async function lockedDraft(
  input: StepInput & { offers: OfferSource },
  ctx: BuildCtx
): Promise<
  | { ok: true; draft: Draft; sendAt: string; changes: ChangeKey[] }
  | { ok: false; code: 'slot_time_invalid' | 'copy_failed' }
> {
  const sections = await sectionsStep(input, ctx)
  if (!sections.ok) return sections
  const locked = await contentStep({ ...input, sections: sections.output }, ctx)
  const copy = await copyStep({ store: input.store, locked }, ctx)
  if (!copy.ok) return copy
  return {
    ok: true,
    draft: copy.output.draft,
    sendAt: sections.output.sendAt,
    changes: copy.output.changes
  }
}

export type BuildCtx = {
  tenantId: string
  callerKey: string
  campaignId?: string | null
  fallbacks: FallbackLog
}

/** All four build steps at once (tests and tools; the job saves each). */
export async function buildEmail(
  input: StepInput & { offers: OfferSource },
  ctx: BuildCtx
): Promise<BuildResult> {
  const made = await lockedDraft(input, ctx)
  if (!made.ok) return made
  return designStep({
    ...input,
    sendAt: made.sendAt,
    sample: input.store.sample,
    copy: { draft: made.draft, changes: made.changes }
  })
}
