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
import { codeSectionPlan, seedVariants } from './sections'
import { lockContent, type ChangeKey } from './content'
import { codeFindings } from './inspect'
import { designA } from './design'
import type { Offers, Store } from './ports'

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
  angle: z.string().min(1).max(200),
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

/** Builds one planned email on the code-only path. Never throws for bad data. */
export async function buildEmail(
  input: { planned: PlannedEmail; store: Store; offers: Offers },
  ctx: {
    tenantId: string
    callerKey: string
    campaignId?: string | null
    fallbacks: FallbackLog
  }
): Promise<BuildResult> {
  const { planned, store, offers } = input
  // The planned local time, as an instant (the earlier one on a DST fold).
  const sendAt = localTimeCandidates(
    `${planned.date}T${planned.time}`,
    store.timezone
  )[0]
  if (!sendAt) return { ok: false, code: 'slot_time_invalid' }
  const assembly: Omit<AssemblyInput, 'brief'> = {
    products: store.products,
    codes: offers.codes,
    maxDiscountPercent: offers.maxDiscountPercent,
    sendAt,
    timezone: store.timezone,
    facts: store.facts
  }
  const allowed = allowedBlockTypes({
    ...assembly,
    brief: {
      campaignType: planned.emailType,
      goal: planned.angle,
      ...(planned.offer ? { offerCode: planned.offer.code } : {})
    }
  })
  const sections = codeSectionPlan({
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
  const locked = await lockContent(
    {
      slot: planned,
      sections,
      store: assembly,
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
  let html: string
  try {
    html = designA(plain.draft, store.brand).html
  } catch {
    return { ok: false, code: 'render_failed' }
  }
  return {
    ok: true,
    email: {
      sample: store.sample,
      ai: false,
      name: `${dayName(planned.date)} · ${typeName(planned.emailType)}`,
      subject: plain.draft.subject,
      preheader: plain.draft.preheader,
      html,
      approach: 'A',
      copy: 'plain',
      plannedSendAt: sendAt,
      audienceId: planned.audience.id,
      productIds: plain.draft.productIds,
      code: plain.draft.code,
      changes: [...new Set(locked.changes.map((c): ChangeKey => c.key))].slice(
        0,
        40
      )
    }
  }
}
