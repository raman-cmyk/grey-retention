import { z } from 'zod'
import { InMemoryMemoryStore, type MemoryStore } from '@/features/agents/memory'
import {
  InMemoryRunLog,
  type AiCall,
  type RunLog
} from '@/features/agents/runtime'
import type { FallbackLog } from '@/features/fallback/log'
import { keyPart } from '@/features/fallback/entry'
import {
  allowedBlockTypes,
  type AssemblyInput
} from '@/features/assembly/inputs'
import { assembleLocked, assembleLockedPlain } from '@/features/assembly/modes'
import { localTimeCandidates } from '@/lib/local-time'
import {
  codeSectionPlan,
  planSections,
  seedVariants,
  type SectionPlan
} from './sections'
import { lockContent, type ChangeKey, type LockedContent } from './content'
import {
  codeFindings,
  copyRounds,
  copyWork,
  hiddenChars,
  type CopyWork,
  type Finding
} from './inspect'
import { copywriterRun } from './copywriter'
import { agentCallMs, maxStepSaves } from './step-names'
import { designA } from './design'
import type { Draft } from '@/features/assembly/assemble'
import type { DiscountCode, OfferSource } from '@/features/offers/source'
import { offersAt, type Store } from './ports'

/**
 * EML-004 part 2: one planned email, built from start to finish: the safe
 * section layout, products placed in plan order, plain facts-only copy
 * that must pass every code check, and coded blocks (approach A), with no
 * AI. REL-AI part 2: with the owner's switch on and a live model
 * (`BuildCtx.agents`), the Section planner and the Content locker choose
 * the sections and place the products (each checked, else code, logged);
 * the Copywriter writes the words, and the Brand and Email inspectors
 * check them (part 2b), in rounds saved between claims; the design follows
 * in part 2c.
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
      /** Short codes for the build's error column. */
      code:
        | 'slot_time_invalid'
        | 'offers_unreadable'
        | 'copy_failed'
        | 'subject_taken'
        | 'ai_unavailable'
        | 'render_failed'
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
export type CopyOutput = {
  draft: Draft
  changes: ChangeKey[]
  /** The Copywriter's words passed every check (REL-AI part 2b). */
  written?: boolean
}

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
  | { ok: false; code: 'slot_time_invalid' | 'offers_unreadable' }
> {
  const { planned, store, offers } = input
  // The planned local time, as an instant (the earlier one on a DST fold).
  const sendAt = localTimeCandidates(
    `${planned.date}T${planned.time}`,
    store.timezone
  )[0]
  if (!sendAt) return { ok: false, code: 'slot_time_invalid' }
  // A planned offer needs the saved offers: a read that failed is tried
  // again (REL-084), never built as "no discount" with the wrong reason.
  // An email without an offer goes on with none.
  const saved = await offers.offers(ctx.tenantId, sendAt).catch(() => null)
  if (!saved && planned.offer) return { ok: false, code: 'offers_unreadable' }
  const read = await offersAt(
    { offers: async () => saved },
    ctx.tenantId,
    sendAt
  )
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
  const sectionInput = {
    mode: 'scratch' as const,
    industry: store.industry,
    slot: {
      emailType: planned.emailType,
      angle: planned.angle,
      products: planned.products.length,
      offer: !!planned.offer
    },
    allowed,
    library: seedVariants
  }
  // REL-AI part 2: the Section planner when the agents are on (it checks,
  // retries and falls back to the safe plan itself, logged); else code.
  const layout = ctx.agents
    ? await planSections(sectionInput, {
        tenantId: ctx.tenantId,
        callerKey: ctx.callerKey,
        memory: ctx.agents.memory,
        log: ctx.agents.log,
        ai: ctx.agents.ai,
        fallbacks: ctx.fallbacks
      })
    : codeSectionPlan(sectionInput)
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
    // REL-AI part 2: the Content locker agent places the products when the
    // agents are on (checked, retried, else code's placement, logged).
    ctx.agents
      ? {
          ...ctx,
          industry: store.industry,
          agent: true,
          memory: ctx.agents.memory,
          log: ctx.agents.log,
          ai: ctx.agents.ai
        }
      : {
          ...ctx,
          agent: false,
          memory: new InMemoryMemoryStore(),
          log: new InMemoryRunLog(),
          ai: noAi
        }
  )
}

/** Subjects compared the way an inbox shows them: case and spacing aside. */
export const subjectKey = (subject: string) =>
  subject.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Store text (a product title, the brand name) as it may stand in a
 * subject: hidden characters dropped, spacing made single; null when it
 * holds anything a template or an inbox could read as markup (`{` `}` `<`
 * `>`), since the copy checks mask product titles and cannot judge them.
 */
export function subjectText(text: string) {
  const clean = text.replace(hiddenChars, '').replace(/\s+/g, ' ').trim()
  return clean && !/[{}<>]/.test(clean) ? clean : null
}

/**
 * REL-AI: two emails in one plan never share a subject. The subjects the
 * plan's other emails already use (`taken`) are skipped: the plain copy's
 * own subject when it is free, else the first of a few fixed, facts-only
 * subjects (the locked products' titles, the brand name and the send day,
 * never a claim, price or code) that is free, safe store text
 * (`subjectText`) and passes every code check. Null when none.
 */
export function uniqueSubject(
  plain: Parameters<typeof codeFindings>[0],
  locked: LockedContent,
  brandName: string,
  taken: ReadonlySet<string>
): string | null {
  const free = (subject: string) => !taken.has(subjectKey(subject))
  const own = plain.draft.subject
  if (free(own) && subjectText(own) === own.replace(/\s+/g, ' ').trim())
    return own
  const brand = subjectText(brandName)
  if (!brand) return null
  const titles = [
    ...new Set(
      locked.sections.flatMap((s) =>
        s.products.flatMap((p) => subjectText(p.title) ?? [])
      )
    )
  ]
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    timeZone: locked.input.timezone
  }).format(new Date(locked.input.sendAt))
  const candidates = [
    ...titles.map((t) => `${t} from ${brand}`),
    ...titles,
    `More from ${brand}`,
    `A note from ${brand}`,
    `This week at ${brand}`,
    `Inside ${brand}`,
    `From the ${brand} shop`,
    `${brand} this ${day}`,
    `A ${day} note from ${brand}`,
    ...titles.map((t) => `${brand}: ${t}`)
  ].filter((c) => c.length <= 60)
  for (const subject of candidates) {
    if (!free(subject)) continue
    const draft = { ...plain.draft, subject }
    if (!codeFindings({ ...plain, draft }, locked, brandName).length)
      return subject
  }
  return null
}

/** A model call ends this long after it starts, with its database calls. */
const callSlackMs = 2_000

/** REL-AI: a subject another email of the plan has goes back to the writer. */
const takenSubject =
  (taken: ReadonlySet<string>) =>
  (draft: Draft): Finding[] =>
    taken.has(subjectKey(draft.subject))
      ? [
          {
            by: 'code',
            rule: 'subject_taken',
            field: 'subject',
            reason:
              'Another email in this plan already has this subject: write a different one.'
          }
        ]
      : []

/**
 * Step 3: the words. On the code-only path, plain facts-only copy that
 * must pass every code check. With the agents (REL-AI part 2b), the
 * Copywriter writes into the locked sections and the code checks, the
 * Brand inspector and the Email inspector judge each draft, up to 3
 * rewrites, then plain copy (`copyRounds`). A claim starts a model call
 * only while it fits before `ctx.until`; otherwise the rounds so far come
 * back as `work`, saved by the job, and the next claim goes on from them.
 */
export async function copyStep(
  input: {
    store: Store
    locked: LockedContent
    /** Subjects the plan's other emails use (REL-AI). */
    taken?: readonly string[]
    /** The rounds an earlier claim saved (REL-AI part 2b). */
    work?: unknown
    /** How often this step has saved its rounds. */
    saves?: number
  },
  ctx: BuildCtx
): Promise<
  | { ok: true; output: CopyOutput }
  | { ok: true; work: CopyWork }
  | {
      ok: false
      code: 'copy_failed' | 'subject_taken' | 'ai_unavailable'
      retryAfterSeconds?: number
    }
> {
  const { store, locked } = input
  const steps = locked.sections.map((s) => ({
    type: s.family,
    reason: s.purpose
  }))
  const taken = new Set((input.taken ?? []).map(subjectKey))
  const changes = [
    ...new Set(locked.changes.map((c): ChangeKey => c.key))
  ].slice(0, 40)
  if (ctx.agents) {
    const agents = ctx.agents
    const saved = copyWork.safeParse(input.work)
    const now = ctx.clock ?? Date.now
    const until = ctx.until
    const made = await copyRounds(
      {
        locked,
        brandName: store.brand.name,
        write: (feedback) =>
          assembleLocked(
            locked.input,
            store.brand,
            copywriterRun(agents, {
              tenantId: ctx.tenantId,
              callerKey: ctx.callerKey,
              industry: store.industry
            }),
            steps,
            feedback
          ),
        plain: () => assembleLockedPlain(locked.input, store.brand, steps),
        checks: takenSubject(taken),
        // Saved by an older app in another shape: the rounds start over.
        ...(saved.success ? { work: saved.data as unknown as CopyWork } : {}),
        ...(until !== undefined
          ? { fits: () => now() + agentCallMs + callSlackMs <= until }
          : {}),
        // The database takes no more saves: out of time means plain copy.
        last: (input.saves ?? 0) >= maxStepSaves
      },
      {
        tenantId: ctx.tenantId,
        callerKey: ctx.callerKey,
        campaignId: ctx.campaignId ?? null,
        industry: store.industry,
        memory: agents.memory,
        log: agents.log,
        ai: agents.ai,
        fallbacks: ctx.fallbacks
      }
    )
    if (made.status === 'paused') return { ok: true, work: made.work }
    if (made.status === 'passed')
      return { ok: true, output: { draft: made.draft, changes, written: true } }
    if (made.status === 'retry')
      return {
        ok: false,
        code: 'ai_unavailable',
        ...(made.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: made.retryAfterSeconds }
          : {})
      }
    // Logged by the rounds; plain copy below (its subject made free).
    if (made.status === 'failed') return { ok: false, code: 'copy_failed' }
  }
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
  const subject = uniqueSubject(plain, locked, store.brand.name, taken)
  if (!subject) {
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
  return {
    ok: true,
    output: { draft: { ...plain.draft, subject }, changes }
  }
}

/** Step 4: the copy drawn with coded design A, as the email to store. */
export function designStep(
  input: StepInput & {
    sendAt: string
    sample: boolean
    copy: CopyOutput
    /** An agent made part of it (REL-AI part 2): the screen says so. */
    ai?: boolean
  }
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
      ai: (input.ai ?? false) || copy.written === true,
      name: `${dayName(planned.date)} · ${typeName(planned.emailType)}`,
      subject: draft.subject,
      preheader: draft.preheader,
      html,
      approach: 'A',
      copy: copy.written ? 'written' : 'plain',
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
  input: StepInput & {
    offers: OfferSource
    /** Subjects the plan's other emails use (REL-AI). */
    taken?: readonly string[]
  },
  ctx: BuildCtx
): Promise<
  | {
      ok: true
      draft: Draft
      sendAt: string
      changes: ChangeKey[]
      /** An agent's plan, placement or words were used (REL-AI part 2). */
      ai: boolean
      /** The Copywriter's words (REL-AI part 2b). */
      written: boolean
    }
  | {
      ok: false
      code:
        | 'slot_time_invalid'
        | 'offers_unreadable'
        | 'copy_failed'
        | 'subject_taken'
        | 'ai_unavailable'
    }
> {
  const sections = await sectionsStep(input, ctx)
  if (!sections.ok) return sections
  const locked = await contentStep({ ...input, sections: sections.output }, ctx)
  // No time limit here (`ctx.until`): the rounds run to their end.
  const copy = await copyStep(
    { store: input.store, locked, taken: input.taken },
    { ...ctx, until: undefined }
  )
  if (!copy.ok) return copy
  if (!('output' in copy)) throw new Error('Copy paused without a time')
  return {
    ok: true,
    draft: copy.output.draft,
    sendAt: sections.output.sendAt,
    changes: copy.output.changes,
    written: copy.output.written === true,
    ai:
      sections.output.layout.source === 'agent' ||
      locked.source === 'agent' ||
      copy.output.written === true
  }
}

/**
 * The agents a build step may ask (REL-AI part 2), or none for the
 * code-only path. Built by `buildAgentsFor` (`./agents`): the metered AI
 * call, the shared memory and the run log.
 */
export type BuildAgents = { memory: MemoryStore; log: RunLog; ai: AiCall }

export type BuildCtx = {
  tenantId: string
  callerKey: string
  campaignId?: string | null
  fallbacks: FallbackLog
  /** Null or missing: the code-only path (no AI call). */
  agents?: BuildAgents | null
  /**
   * When this claim must end (ms since epoch; REL-AI part 2b): a step with
   * rounds starts a model call only while one fits before it. Missing: no
   * time limit (tests and tools).
   */
  until?: number
  /** The clock for `until` (ms since epoch); default `Date.now`. */
  clock?: () => number
}

/** All four build steps at once (tests and tools; the job saves each). */
export async function buildEmail(
  input: StepInput & { offers: OfferSource; taken?: readonly string[] },
  ctx: BuildCtx
): Promise<BuildResult> {
  const made = await lockedDraft(input, ctx)
  if (!made.ok) return made
  return designStep({
    ...input,
    sendAt: made.sendAt,
    sample: input.store.sample,
    ai: made.ai,
    copy: { draft: made.draft, changes: made.changes, written: made.written }
  })
}
