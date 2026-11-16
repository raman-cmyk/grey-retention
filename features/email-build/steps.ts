import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { OfferSource } from '@/features/offers/source'
import {
  codeWorksNow,
  contentStep,
  emailName,
  shownOffer,
  copyStep,
  designStep,
  sectionsStep,
  subjectText,
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
import {
  checkWholeEmail,
  emailCheckReasons,
  emailViewsMs,
  viewKey
} from '@/features/studio/email-check'
import { hardProblems } from './hard-checks'
import { letterSchema } from '@/features/letter/letter'
import {
  letterCopyStep,
  letterDesignStep,
  type LetterCopy
} from './letter-steps'
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
/** A text email's saved copy step (TXT-001d): its letter, checked again. */
const letterSaved = z.looseObject({
  letter: z.unknown(),
  productIds: z.array(z.string()).max(12),
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
        | 'format_changed'
        | 'hard_check_failed'
    }

const unreadable = { ok: false, code: 'step_progress_invalid' } as const

const hostOf = (url: string | undefined) => {
  try {
    return url ? [new URL(url).hostname.toLowerCase()] : []
  } catch {
    return []
  }
}

/** DST-005: the hard checks on an email as drawn, before it is stored. */
const checksFor =
  (store: Store, rules: SectionsOutput['rules']) => (html: string) =>
    hardProblems(html, {
      maxDiscountPercent: rules.maxDiscountPercent,
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
          output: {
            ...made.output,
            store: storeFingerprint(store),
            // TXT-001d: a later step of another format starts over.
            format: planned.format ?? 'designed'
          }
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
  // TXT-001d (D26): the slot switched between designed and text since the
  // first step: its saved steps are another email's. Missing before it.
  const format = (progress.data.sections as { format?: unknown }).format
  if (format !== undefined && format !== (planned.format ?? 'designed'))
    return { ok: false, code: 'format_changed' }
  if (step === 'content')
    return {
      ok: true,
      done: 'content',
      output: await contentStep({ planned, store, sections }, ctx)
    }
  if (step === 'copy') {
    const locked = contentSaved.safeParse(progress.data.content)
    if (!locked.success) return unreadable
    // TXT-001d: a text email's letter, written or plain.
    if (planned.format === 'text') {
      const made = await letterCopyStep(
        {
          store,
          locked: locked.data as unknown as LockedContent,
          taken: input.taken,
          ...(planned.letterKind ? { kind: planned.letterKind } : {})
        },
        ctx
      )
      return made.ok ? { ok: true, done: 'copy', output: made.output } : made
    }
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
  if (planned.format === 'text')
    return letterDesign(
      { ...input, sections, content: progress.data.content },
      progress.data.copy,
      ctx
    )
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
  /** The studio's outcome once its pictures are in (DST-006d). */
  let studioDone:
    { work?: object; budget?: { until: number; waits: number } } | undefined
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
    studioDone = studio
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
  const checksOf = checksFor(store, sections.rules)
  let made = draw(drawn)
  let problems = made.ok ? checksOf(made.email.html) : []
  const pictured = drawn.draft.blocks.some(
    (b) => (b?.content as { picture?: unknown } | undefined)?.picture
  )
  /** The studio's email, drawn and through the hard checks. */
  const studioEmail =
    made.ok && !problems.length && pictured ? made.email : null
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
  // DST-006d: the studio's email is judged whole, from its inbox views,
  // before it is stored; short of a pass it is drawn with its coded blocks
  // (D16), and the owner's log says why in fixed words (never the critic's
  // own: it may read the email's words, a code among them).
  const views = ctx.studio?.email
  if (studioEmail && views && studioDone?.work && studioDone.budget) {
    // The views' own window, from when they were first asked for (kept in
    // the work); the rounds' time is theirs.
    const kept = (saved as { studio?: { views?: { until?: unknown } } })?.studio
      ?.views?.until
    const viewsUntil =
      Number.isSafeInteger(kept) && (kept as number) > 0
        ? (kept as number)
        : ctx.studio!.now() + emailViewsMs
    const check = await checkWholeEmail(
      {
        html: studioEmail.html,
        key: viewKey(studioEmail.html),
        until: viewsUntil,
        waits: studioDone.budget.waits
      },
      { ...views, fits: ctx.studio!.fits, now: ctx.studio!.now }
    )
    if ('wait' in check || 'paused' in check) {
      // Saved as the studio's own waits are: one more of its 6.
      const work = studioDone.work as {
        studio: { rounds: { waits: number } & object }
      }
      return {
        ok: true,
        waiting: 'design',
        work: {
          studio: {
            ...work.studio,
            rounds: {
              ...work.studio.rounds,
              waits: work.studio.rounds.waits + 1
            },
            views: { until: viewsUntil }
          }
        },
        seconds: 'wait' in check ? check.wait.seconds : check.paused.seconds
      }
    }
    if (!check.pass) {
      made = draw(plain)
      problems = made.ok ? checksOf(made.email.html) : []
      if (made.ok && !problems.length)
        await ctx.fallbacks.record({
          tenantId: ctx.tenantId,
          campaignId: ctx.campaignId ?? null,
          agent: 'design-studio',
          reasonCode: `email_${check.reason}`,
          reason: clip(
            check.problem
              ? `${emailCheckReasons[check.reason]} ${check.problem}`
              : emailCheckReasons[check.reason],
            500
          ),
          fallback: 'Drew the email with its coded blocks.',
          attempts: 1,
          detail: {},
          dedupeKey: `design-studio:${keyPart(ctx.callerKey)}:email-check`
        })
    }
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
  // EML-AB (D21): the studio's email passed every check, so it goes as
  // design B beside its coded blocks as design A (the same content and
  // words, through the same hard checks), in one Klaviyo draft, half the
  // audience each, no winner picked. Each is under Gmail's size (DST-005),
  // so both fit what is stored. Short of A, B goes alone, logged.
  const studioPassed = made.ok && !!studioEmail && made.email === studioEmail
  if (made.ok && studioPassed) {
    const a = draw(plain)
    const codedHtml =
      a.ok && !checksOf(a.email.html).length ? a.email.html : null
    made = {
      ok: true,
      email: {
        ...made.email,
        approach: 'B',
        ...(codedHtml ? { designA: codedHtml } : {})
      }
    }
    if (!codedHtml)
      await ctx.fallbacks.record({
        tenantId: ctx.tenantId,
        campaignId: ctx.campaignId ?? null,
        agent: 'ab-test',
        reasonCode: 'ab_no_coded',
        reason: 'Its coded design did not pass the email checks.',
        fallback:
          'Only the designed email goes into Klaviyo as a draft, with no A/B test.',
        attempts: 1,
        detail: {},
        dedupeKey: `ab-test:${keyPart(ctx.callerKey)}:no-coded`
      })
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
  return made.ok
    ? { ok: true, done: 'design', email: withSubjectB(made.email, plain) }
    : made
}

/** The lab's B as saved with the copy step (PIC-26 part 2). */
const savedLab = z.object({
  b: z.object({ subject: z.string().trim().min(1).max(120) }).nullable()
})

/**
 * PIC-26 part 3b: an email with one design tests the lab's B against its
 * subject, half the audience each. Never beside a design test (one test
 * an email), never on plain copy (it has no lab), never B the same as A.
 */
function withSubjectB(email: BuiltEmail, copy: CopyOutput): BuiltEmail {
  if (email.designA || email.text !== undefined || !copy.written) return email
  const lab = savedLab.safeParse(copy.subjectLab)
  const b = lab.success ? lab.data.b?.subject : undefined
  // Compared as the pusher compares them (spaces as one, any case), and
  // safe store text as the copy step checked it (no tag, no markup).
  const same = (x: string) => x.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!b || subjectText(b) !== b || same(b) === same(email.subject))
    return email
  return { ...email, subjectB: b }
}

/**
 * TXT-001d: a text email’s design step: its saved letter checked again,
 * its code still a working one (REL-OFF), drawn as a letter, then the
 * hard checks every email gets. No studio: a letter has no pictures.
 */
async function letterDesign(
  input: {
    planned: PlannedEmail
    store: Store
    offers: OfferSource
    sections: SectionsOutput
    content: unknown
  },
  saved: unknown,
  ctx: BuildCtx
): Promise<StepResult> {
  const { planned, store, sections } = input
  const read = letterSaved.safeParse(saved)
  const letter = read.success ? letterSchema.safeParse(read.data.letter) : null
  if (!read.success || !letter?.success) return unreadable
  const copy: LetterCopy = {
    letter: letter.data,
    productIds: read.data.productIds,
    changes: read.data.changes as LetterCopy['changes'],
    ...(read.data.written ? { written: true } : {})
  }
  const code = copy.letter.offer?.code ?? null
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
  const made = letterDesignStep({
    planned,
    store,
    sendAt: sections.sendAt,
    sample: sections.sample,
    copy,
    rules: sections.rules,
    ai: (input.content as { source?: unknown } | undefined)?.source === 'agent',
    name: emailName(planned)
  })
  if (!made.ok) return made
  const problems = checksFor(store, sections.rules)(made.email.html)
  if (problems.length) {
    await ctx.fallbacks.record({
      tenantId: ctx.tenantId,
      campaignId: ctx.campaignId ?? null,
      agent: 'email-checks',
      reasonCode: `hard_check_${problems[0]!.check}`,
      reason: clip(problems.map((p) => p.problem).join(' '), 500),
      fallback: 'No email was stored; trying again makes it again.',
      attempts: 1,
      detail: { checks: problems.map((p) => p.check) },
      dedupeKey: `email-checks:${keyPart(ctx.callerKey)}:letter`
    })
    return { ok: false, code: 'hard_check_failed' }
  }
  return { ok: true, done: 'design', email: made.email }
}
