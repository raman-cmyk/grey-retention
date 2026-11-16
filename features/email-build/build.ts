import { z } from 'zod'
import { emailFormats, type EmailFormat } from '@/features/strategy/plan'
import { InMemoryMemoryStore, type MemoryStore } from '@/features/agents/memory'
import {
  InMemoryRunLog,
  type AiCall,
  type RunLog
} from '@/features/agents/runtime'
import type { FallbackLog } from '@/features/fallback/log'
import { assemblyFallback, keyPart } from '@/features/fallback/entry'
import {
  allowedBlockTypes,
  type AssemblyInput
} from '@/features/assembly/inputs'
import { assembleLocked, assembleLockedPlain } from '@/features/assembly/modes'
import { localTimeCandidates } from '@/lib/local-time'
import { letterKinds } from '@/features/letter/kind-list'
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
  protectedText,
  type CopyWork,
  type Finding
} from './inspect'
import { copywriterRun } from './copywriter'
import { headlineFindings } from './headline-fit'
import { readingFindings } from './reading-level'
import { subjectLab, subjectLabVersion } from './subject-lab'
import { learnFrom, type SubjectTrait } from './subject-traits'
import { agentCallMs, maxStepSaves } from './step-names'
import { designA } from './design'
import { letterCopyStep, letterDesignStep, letterLayout } from './letter-steps'
import {
  AssemblyError,
  factLines,
  hiddenChars,
  type Draft
} from '@/features/assembly/assemble'
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

// D26: the two kinds of email (the plan's, TXT-001f).
export { emailFormats, type EmailFormat }

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
  audience: z.object({ id: z.string(), label: z.string() }),
  /**
   * D26 (TXT-001c): a designed email or a text email (a short letter).
   * Missing on slots planned before it: designed.
   */
  format: z.enum(emailFormats).optional(),
  /** DST-PIC #24: a text email's kind (missing: a short note of no kind). */
  letterKind: z.enum(letterKinds).optional().catch(undefined)
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
  /**
   * TXT-001c: a text email's own plain-text part (Klaviyo's tags for its
   * footer). Missing on designed emails and on emails built before it.
   */
  text: z.string().min(1).max(100_000).optional(),
  /** D26: missing on emails built before it, and on designed ones. */
  format: z.enum(emailFormats).optional(),
  approach: z.enum(['A', 'B']),
  copy: z.enum(['written', 'plain']),
  plannedSendAt: z.string(),
  audienceId: z.string(),
  productIds: z.array(z.string()).max(12),
  code: z.string().nullable(),
  /**
   * REL-OFF: the code's percent and end as the email shows them, so the
   * push checks Settings still give exactly that. Missing on emails built
   * before it.
   */
  offer: z
    .object({ percent: z.number(), expiresAt: z.string().nullable() })
    .nullable()
    .optional(),
  /** Planned content the Content locker replaced with safer choices. */
  changes: z.array(z.string()).max(40),
  /**
   * EML-AB (D21): the same email drawn with its coded blocks (design A)
   * when `html` is the studio's (design B, `approach` B): one Klaviyo
   * draft with the two as variations, half the audience each, no winner
   * picked. Missing when only one design goes.
   */
  designA: z.string().min(1).max(200_000).optional()
})
export type BuiltEmail = z.infer<typeof builtEmail>

export type BuildResult =
  | { ok: true; email: BuiltEmail }
  | {
      ok: false
      /** Short codes for the build's error column. */
      code:
        | 'slot_time_invalid'
        | 'send_time_passed'
        | 'offers_unreadable'
        | 'copy_failed'
        | 'subject_taken'
        | 'offer_unsafe'
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

/** The email's name in Klaviyo: its day and type, e.g. "Tue 18 Nov · Offer". */
export const emailName = (planned: PlannedEmail) =>
  `${dayName(planned.date)} · ${typeName(planned.emailType)}`

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
  /**
   * REL-STO: the store as this step read it (`storeFingerprint`, added by
   * the job's step runner): a later step on other store data starts over.
   * Missing on builds saved before it.
   */
  store?: string
  /** DSC-001: the max and the codes still working when this email sends. */
  rules: { maxDiscountPercent: number; codes: DiscountCode[] }
  layout: SectionPlan
}
export type CopyOutput = {
  draft: Draft
  changes: ChangeKey[]
  /** The Copywriter's words passed every check (REL-AI part 2b). */
  written?: boolean
  /**
   * PIC-26 part 2: what the subject line lab picked among the writer's
   * subjects (A is the draft's subject) and the one worth testing against
   * it (B; part 3 sends it as a 50/50 test), with why.
   */
  subjectLab?: SubjectPick
}

export type SubjectPick = {
  version: string
  /** True when the store's own past emails weighed the ideas. */
  learned: boolean
  /** The ideas weighed (the writer's own and its other ideas that fit). */
  weighed: number
  a: { subject: string; expected: number | null; why: string[] }
  b: { subject: string; expected: number | null; why: string[] } | null
  /** The traits A and B differ in: what a test of them teaches. */
  tests: SubjectTrait[]
}

/**
 * PIC-26 part 2: the subject line lab on the Copywriter's draft. Its own
 * subject (judged by the inspectors) and its other ideas are weighed by
 * the store's own opens (`store.pastSubjects`, PIC-26 part 1); an idea is
 * weighed only when no other email of the plan has it, it is safe store
 * text and every code check passes with it in the draft (the copy checks,
 * the preview line pairing with it). The draft keeps the best as its
 * subject; the ideas never stay in the draft.
 */
export function pickSubject(
  draft: Draft,
  input: {
    locked: LockedContent
    brandName: string
    taken: ReadonlySet<string>
    past: Store['pastSubjects']
  }
): { draft: Draft; pick: SubjectPick | null } {
  const { subjectIdeas, ...kept } = draft
  const ideas = [draft.subject, ...(subjectIdeas ?? [])]
  const lab = subjectLab(ideas, learnFrom(input.past ?? [], input.brandName), {
    brand: input.brandName,
    fits: (subject, index) =>
      // The writer's own subject passed every check already.
      index === 0 ||
      (!input.taken.has(subjectKey(subject)) &&
        subjectText(subject) === subject &&
        !codeFindings(
          { status: 'ready', draft: { ...kept, subject } },
          input.locked,
          input.brandName
        ).length)
  })
  if (!lab.a) return { draft: kept, pick: null }
  const side = (r: NonNullable<typeof lab.a>) => ({
    subject: r.subject,
    expected: r.expected,
    why: r.why
  })
  return {
    draft: { ...kept, subject: lab.a.subject },
    pick: {
      version: subjectLabVersion,
      learned: lab.learned,
      weighed: lab.ranked.length,
      a: side(lab.a),
      b: lab.b ? side(lab.b) : null,
      tests: lab.tests
    }
  }
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
  facts: store.facts,
  // ONB-061: the customers' own words, for the Copywriter to borrow.
  ...(store.customerWords?.length ? { customerWords: store.customerWords } : {})
})

/**
 * REL-OFF: a code the email may carry: one of the saved working codes, a
 * whole percent from 1 to the max, still working when the email sends.
 * The Content locker locks only such a code and the copy checks hold the
 * email to it; this is the last check before the email is stored.
 */
export function codeWorks(
  code: string,
  rules: SectionsOutput['rules'],
  sendAt: string
) {
  const wanted = codeKey(code)
  const found = rules.codes.find((c) => codeKey(c.code) === wanted)
  if (
    !found ||
    !Number.isInteger(found.percent) ||
    found.percent < 1 ||
    found.percent > Math.min(100, rules.maxDiscountPercent)
  )
    return false
  const ends = found.expiresAt === null ? null : Date.parse(found.expiresAt)
  return ends === null || (Number.isFinite(ends) && ends > Date.parse(sendAt))
}

const codeKey = (code: string) => code.trim().toUpperCase()

/**
 * REL-OFF: the offer the email shows is exactly a working one: no offer
 * section without a code, and with a code (`codeWorks`) every offer
 * section shows that code at its own percent. What is drawn, not only
 * what the draft says.
 */
export function offerShown(
  draft: Draft,
  rules: SectionsOutput['rules'],
  sendAt: string
) {
  const banners = draft.blocks.filter((b) => b.type === 'offer_banner')
  if (draft.code === null) return banners.length === 0
  if (!banners.length || !codeWorks(draft.code, rules, sendAt)) return false
  const wanted = codeKey(draft.code)
  const found = rules.codes.find((c) => codeKey(c.code) === wanted)!
  return banners.every((b) => {
    const c = b.content as { code?: unknown; headline?: unknown }
    return (
      typeof c.code === 'string' &&
      codeKey(c.code) === wanted &&
      c.headline === `${found.percent}% off`
    )
  })
}

/**
 * REL-OFF: the code against the owner's Settings now, not only as the
 * first step saved them: a code switched off or a max lowered since never
 * reaches Klaviyo. `unreadable` when Settings could not be read (tried
 * again).
 */
export async function codeWorksNow(
  code: string,
  offers: OfferSource,
  tenantId: string,
  sendAt: string,
  /**
   * The percent and end the email shows: a code removed and added again
   * at another percent or end since is refused too (the email would say
   * what the code no longer gives).
   */
  shown?: { percent: number; expiresAt: string | null } | null
): Promise<'ok' | 'unsafe' | 'unreadable'> {
  const read = await offers.offers(tenantId, sendAt).catch(() => null)
  if (!read) return 'unreadable'
  const rules = {
    maxDiscountPercent: read.maxDiscountPercent ?? 0,
    codes: [...read.codes]
  }
  if (!codeWorks(code, rules, sendAt)) return 'unsafe'
  if (!shown) return 'ok'
  const now = rules.codes.find((c) => codeKey(c.code) === codeKey(code))!
  return now.percent === shown.percent &&
    sameEnd(now.expiresAt, shown.expiresAt)
    ? 'ok'
    : 'unsafe'
}

const sameEnd = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : Date.parse(a) === Date.parse(b)

/** The percent and end of the code an email carries, from its saved rules. */
export function shownOffer(
  code: string | null,
  rules: SectionsOutput['rules']
) {
  if (code === null) return null
  const found = rules.codes.find((c) => codeKey(c.code) === codeKey(code))
  return found ? { percent: found.percent, expiresAt: found.expiresAt } : null
}

/** Step 1: the send time, the offer rules at that time, and the sections. */
export async function sectionsStep(
  input: StepInput & { offers: OfferSource },
  ctx: BuildCtx
): Promise<
  | { ok: true; output: SectionsOutput }
  | {
      ok: false
      code: 'slot_time_invalid' | 'send_time_passed' | 'offers_unreadable'
    }
> {
  const { planned, store, offers } = input
  // The planned local time, as an instant (the earlier one on a DST fold).
  const sendAt = localTimeCandidates(
    `${planned.date}T${planned.time}`,
    store.timezone
  )[0]
  if (!sendAt) return { ok: false, code: 'slot_time_invalid' }
  // REL-DAT: an email whose send time has passed is never made (its day
  // may be today: "Create email" accepts today's emails).
  if (Date.parse(sendAt) <= (ctx.clock ?? Date.now)())
    return { ok: false, code: 'send_time_passed' }
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
  // retries and falls back to the safe plan itself, logged); else code. A
  // text email (TXT-001c) skips it: only what the letter locks.
  const layout =
    planned.format === 'text'
      ? letterLayout(planned)
      : ctx.agents
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
    // agents are on (checked, retried, else code's placement, logged). A
    // text email locks only its lead product: code places it, no AI call.
    ctx.agents && planned.format !== 'text'
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

// Control, zero-width and direction characters: never in a subject.
const hidden = new RegExp(hiddenChars.source, 'g')

/**
 * Store text (a product title, the brand name) as it may stand in a
 * subject: hidden characters dropped, spacing made single; null when it
 * holds anything a template or an inbox could read as markup (`{` `}` `<`
 * `>`), since the copy checks mask product titles and cannot judge them.
 */
export function subjectText(text: string) {
  // Spaces first (a tab is one), then hidden characters, as `oneLine`.
  const clean = text
    .replace(/\s+/g, ' ')
    .replace(hidden, '')
    .replace(/\s+/g, ' ')
    .trim()
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
export const callSlackMs = 2_000

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
  | { ok: false; code: 'copy_failed' | 'subject_taken' }
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
    const rounds = copyRounds(
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
        // DST-PIC #20: the Copywriter's headlines fit their sections;
        // #28: its sections' words and reading level, by industry.
        laterChecks: (draft) => [
          ...headlineFindings(
            draft,
            locked.input.products.map((p) => p.title)
          ),
          ...readingFindings(draft, store.industry, [
            ...protectedText(locked, store.brand.name),
            // The facts the writer must use word for word (with or without
            // their full stop).
            ...factLines(locked.input.facts).flatMap((f) => [
              f,
              f.replace(/[.!?]$/, '')
            ])
          ])
        ],
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
    // The Content locker locks only what the brief can show, so the
    // Copywriter's own checks of it fail only on a bug: plain copy, logged.
    const made = await rounds.catch(async (error: unknown) => {
      if (!(error instanceof AssemblyError)) throw error
      await ctx.fallbacks.record(
        assemblyFallback({
          tenantId: ctx.tenantId,
          campaignId: ctx.campaignId ?? null,
          subject: ctx.callerKey,
          revision: 0,
          error,
          fallback: 'Used plain copy: the facts only, in the locked sections.'
        })
      )
      return null
    })
    if (made?.status === 'paused') return { ok: true, work: made.work }
    if (made?.status === 'passed') {
      const { draft, pick } = pickSubject(made.draft, {
        locked,
        brandName: store.brand.name,
        taken,
        past: store.pastSubjects
      })
      return {
        ok: true,
        output: {
          draft,
          changes,
          written: true,
          ...(pick ? { subjectLab: pick } : {})
        }
      }
    }
    if (made?.status === 'failed') return { ok: false, code: 'copy_failed' }
    // A busy AI: no job runs the agents later (the sweep has none), so the
    // email gets plain copy now, with the reason, not later without one.
    if (made?.status === 'retry')
      await ctx.fallbacks.record({
        tenantId: ctx.tenantId,
        campaignId: ctx.campaignId ?? null,
        agent: 'copy-inspectors',
        reasonCode: 'copy_ai_busy',
        reason: 'The AI was busy or could not be reached.',
        fallback: 'Used plain copy: the facts only, in the locked sections.',
        attempts: Math.min(made.rounds.length + 1, 10),
        detail: { code: made.code.slice(0, 40) },
        dedupeKey: `copy-inspectors:busy:${keyPart(ctx.callerKey)}`
      })
    // Plain copy (logged by the rounds, or above), its subject made free.
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
    /** The offer rules the first step saved (REL-OFF). */
    rules: SectionsOutput['rules']
    /** An agent made part of it (REL-AI part 2): the screen says so. */
    ai?: boolean
  }
): BuildResult {
  const { planned, store, sendAt, sample, copy } = input
  const { draft } = copy
  // REL-OFF: a wrong code never reaches Klaviyo, whatever went wrong before.
  if (!offerShown(draft, input.rules, sendAt))
    return { ok: false, code: 'offer_unsafe' }
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
      name: emailName(planned),
      subject: draft.subject,
      preheader: draft.preheader,
      html,
      approach: 'A',
      copy: copy.written ? 'written' : 'plain',
      plannedSendAt: sendAt,
      audienceId: planned.audience.id,
      productIds: draft.productIds,
      code: draft.code,
      offer: shownOffer(draft.code, input.rules),
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
      /** The offer rules the first step saved (REL-OFF). */
      rules: SectionsOutput['rules']
    }
  | {
      ok: false
      code:
        | 'slot_time_invalid'
        | 'send_time_passed'
        | 'offers_unreadable'
        | 'copy_failed'
        | 'subject_taken'
        | 'offer_unsafe'
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
  // REL-OFF: the A-vs-B test draws this draft itself: the same last check.
  if (
    !offerShown(
      copy.output.draft,
      sections.output.rules,
      sections.output.sendAt
    )
  )
    return { ok: false, code: 'offer_unsafe' }
  return {
    ok: true,
    draft: copy.output.draft,
    sendAt: sections.output.sendAt,
    rules: sections.output.rules,
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
 * call, the shared memory and the run log. Only with a live model: the
 * Copywriter treats every answer through `ai` as a live one.
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
  /**
   * The wall clock (ms since epoch; default `Date.now`): for `until`, and
   * for refusing a send time that has passed (REL-DAT).
   */
  clock?: () => number
}

/** A text email's four steps at once (TXT-001c). */
async function buildLetterEmail(
  input: StepInput & { offers: OfferSource; taken?: readonly string[] },
  ctx: BuildCtx
): Promise<BuildResult> {
  const sections = await sectionsStep(input, ctx)
  if (!sections.ok) return sections
  const locked = await contentStep({ ...input, sections: sections.output }, ctx)
  // No time limit here (`ctx.until`): the rewrites run to their end.
  const copy = await letterCopyStep(
    {
      store: input.store,
      locked,
      taken: input.taken,
      ...(input.planned.letterKind ? { kind: input.planned.letterKind } : {})
    },
    { ...ctx, until: undefined }
  )
  if (!copy.ok) return copy
  return letterDesignStep({
    planned: input.planned,
    store: input.store,
    sendAt: sections.output.sendAt,
    sample: input.store.sample,
    copy: copy.output,
    rules: sections.output.rules,
    ai: locked.source === 'agent' || copy.output.written === true,
    name: emailName(input.planned)
  })
}

/** All four build steps at once (tests and tools; the job saves each). */
export async function buildEmail(
  input: StepInput & { offers: OfferSource; taken?: readonly string[] },
  ctx: BuildCtx
): Promise<BuildResult> {
  if (input.planned.format === 'text') return buildLetterEmail(input, ctx)
  const made = await lockedDraft(input, ctx)
  if (!made.ok) return made
  return designStep({
    ...input,
    sendAt: made.sendAt,
    rules: made.rules,
    sample: input.store.sample,
    ai: made.ai,
    copy: { draft: made.draft, changes: made.changes, written: made.written }
  })
}
