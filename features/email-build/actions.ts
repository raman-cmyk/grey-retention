'use server'

import type { Route } from 'next'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { z } from 'zod'
import { uploadCopyOn } from '@/features/email-uploads/switch'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { Database } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/logger'
import { draftPusherFor } from '@/features/klaviyo-push/live'
import { pushBudgetMs } from '@/features/klaviyo-push/pusher'
import { latestPlanRun } from '@/features/strategy/load'
import { planScreen } from '@/features/strategy/plan-screen'
import { emailAgentsReady } from './agents'
import {
  couldNot,
  createAllWords,
  pickSlots,
  queueAll,
  type QueueAnswer
} from './create-all'
import { runEmailBuilds } from './worker'

export type CreateEmailState = { error?: string; message?: string }

/**
 * Time a click has, counted from the action's start (the plan page allows
 * 120 s); with the agents on, a step starts only while a whole step fits,
 * and the cron sweep (code only) runs the rest.
 */
const clickBudgetMs = 110_000
/**
 * PICK-102 review: kept for a draft push at the end (its 30 s budget and a
 * little more). No build and no step is claimed inside it, and no push
 * request goes past the click's end, so a click ends inside its 120 s.
 */
const pushMarginMs = pushBudgetMs + 5_000

/**
 * Builds these emails right after the reply, one after another inside the
 * click's one budget from `started` (the action's own start). PICK-102:
 * "Create all" hands in several, so a click never runs more than one build
 * at a time; one that throws never stops the next; the cron picks up what
 * the click does not reach.
 */
function buildSoon(started: number, ...builds: string[]) {
  const end = started + clickBudgetMs
  const claimBy = end - pushMarginMs
  after(async () => {
    const service = createServiceClient()
    if (!service) return
    for (const build of builds) {
      if (Date.now() >= claimBy) break
      try {
        // The fake draft pusher unless the owner's write switch is on
        // (KLAVIYO_DRAFT_PUSH=live with KLAVIYO_MODE=live, PSH-001); no
        // push request starts past the click's end.
        await runEmailBuilds(service, {
          build,
          deadline: claimBy,
          pusher: draftPusherFor(service, { deadline: end })
        })
      } catch (error) {
        logger.error('Email build could not start', {
          code: (error as { code?: string }).code ?? 'email_build_error'
        })
      }
    }
  })
}

const createForm = z.object({
  run: z.uuid(),
  // A missing slot must not read as email 0.
  slot: z
    .string()
    .regex(/^\d{1,2}$/)
    .transform(Number)
    .pipe(z.int().min(0).max(19)),
  // DST-002b: how a designed email is made; Scratch unless the owner chose.
  mode: z.enum(['copy', 'remix', 'scratch']).default('scratch')
})

/**
 * "Create email" on a planned email (D17): only the workspace's owner
 * starts it. The email is built and lands in Klaviyo as a draft; nothing
 * is scheduled or sent.
 */
export async function createEmail(
  _state: CreateEmailState,
  form: FormData
): Promise<CreateEmailState> {
  const started = Date.now()
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Only this workspace’s owner creates emails.' }
  const parsed = createForm.safeParse({
    run: form.get('run'),
    slot: form.get('slot'),
    mode: form.get('mode') ?? undefined
  })
  if (!parsed.success)
    return {
      error: parsed.error.issues.every((i) => i.path[0] === 'mode')
        ? 'Choose Copy, Remix or Scratch.'
        : 'Choose an email from the plan.'
    }
  const db = await createClient()
  if (!db) return { error: 'Creating emails is unavailable right now.' }
  // Scratch is the command's default: it is left out, so a Scratch click
  // reads the same before and after the migration that added the mode.
  const { data, error } = await db.rpc('create_email_build', {
    t: context.tenantId,
    run: parsed.data.run,
    slot: parsed.data.slot,
    ...(parsed.data.mode === 'scratch' ? {} : { mode: parsed.data.mode })
  })
  const refused = refusal(error)
  if (refused) return refused
  if (typeof data !== 'string')
    return { error: 'We could not create the email. Try again.' }
  buildSoon(started, data)
  revalidatePath('/plan')
  redirect('/plan' as Route)
}

/** The command's refusals in the owner's words (its codes and hints). */
function refusal(
  error: { code?: string; message?: string; hint?: string } | null
): CreateEmailState | null {
  if (!error) return null
  if (error.code === 'PT409' && /failed 5 times/.test(error.message ?? ''))
    return {
      error:
        'This email could not be made after 5 tries. Plan again for new emails.'
    }
  if (error.code === 'PT409')
    return {
      error:
        'This email’s day has passed or the plan has changed. Plan again to create it.'
    }
  // The command's stable hints, not its words (DST-002b1).
  if (error.code === '22023' && error.hint === 'build_mode_text')
    return {
      error:
        'A text email is written as a letter, not copied or remixed. Create it as it is.'
    }
  if (error.code === '22023' && error.hint === 'build_mode_unknown')
    return { error: 'Choose Copy, Remix or Scratch.' }
  // UI-USE: the inspiration email the owner chose.
  if (error.code === '22023' && error.hint === 'build_mode_reference')
    return { error: 'Choose Copy or Remix.' }
  if (error.code === '22023' && error.hint === 'build_reference_unknown')
    return {
      error:
        'This email is no longer in your Inspiration. Choose another one there.'
    }
  // DES-ENGINE-003b: one of the workspace's own uploaded emails.
  if (error.code === '22023' && error.hint === 'build_upload_unknown')
    return {
      error:
        'This email of yours is not ready, or was deleted. Choose another one in Your emails.'
    }
  if (error.code === '22023')
    return { error: 'This plan has no such email. Reload the page.' }
  return { error: 'We could not create the email. Try again.' }
}

const useForm = z.object({
  run: z.uuid(),
  slot: createForm.shape.slot,
  // Scratch follows no email: a chosen one is copied or remixed.
  mode: z.enum(['copy', 'remix']),
  reference: z.uuid()
})

/**
 * UI-USE: "Use this design" on Inspiration (owner decision of 24 Nov): the
 * owner's "Create email" on the planned email he picked, copied or remixed
 * from the inspiration email he chose. Only the workspace's owner starts
 * it; the email is built and lands in Klaviyo as a draft, as on the Plan
 * (D16, D17), and the email's own page shows its progress.
 */
export async function createEmailFromInspiration(
  _state: CreateEmailState,
  form: FormData
): Promise<CreateEmailState> {
  const started = Date.now()
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Only this workspace’s owner creates emails.' }
  const parsed = useForm.safeParse({
    run: form.get('run'),
    slot: form.get('slot'),
    mode: form.get('mode'),
    reference: form.get('reference')
  })
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((i) => i.path[0]))
    return {
      error: fields.has('reference')
        ? 'Choose an email in Inspiration first.'
        : fields.has('run') || fields.has('slot')
          ? 'Choose a planned email.'
          : 'Choose Copy or Remix.'
    }
  }
  const db = await createClient()
  if (!db) return { error: 'Creating emails is unavailable right now.' }
  // The command's `reference` is newer than the generated types (UI-USE;
  // BUILD_LEDGER Known issues): named by hand here and in the read below.
  const args: CreateEmailBuildArgs & { reference: string } = {
    t: context.tenantId,
    run: parsed.data.run,
    slot: parsed.data.slot,
    mode: parsed.data.mode,
    reference: parsed.data.reference
  }
  const { data, error } = await db.rpc(
    'create_email_build',
    args as CreateEmailBuildArgs
  )
  const refused = refusal(error)
  if (refused) return refused
  if (typeof data !== 'string')
    return { error: 'We could not create the email. Try again.' }
  // Clicking on a planned email already being made returns that build (a
  // stale page, another tab): it keeps the mode and email it was started
  // with, so the owner is told instead of landing on it silently.
  const made = (await db
    .from('email_builds')
    .select('mode,reference_id')
    .eq('id', data)
    .eq('tenant_id', context.tenantId)
    .maybeSingle()) as unknown as {
    data: { mode: string; reference_id: string | null } | null
    error: unknown
  }
  if (
    made.data &&
    (made.data.mode !== parsed.data.mode ||
      made.data.reference_id !== parsed.data.reference)
  ) {
    revalidatePath('/plan')
    return { error: alreadyMade }
  }
  buildSoon(started, data)
  revalidatePath('/plan')
  redirect(`/plan/email/${data}` as Route)
}

/** A planned email already being made from another design, or another way. */
const alreadyMade =
  'This email is already being made from another design. Open it on your plan.'

type CreateEmailBuildArgs =
  Database['public']['Functions']['create_email_build']['Args']

const uploadUseForm = z.object({
  run: z.uuid(),
  slot: createForm.shape.slot,
  upload: z.uuid()
})

/**
 * DES-ENGINE-003b: "Use this design" on one of the workspace's own
 * uploaded emails ("Add your own email"): Create email on the planned
 * email the owner picked, copied from his upload (his brand's own design
 * keeps its look; another brand's email is copied like a library email).
 * Only the owner starts it, with the owner's switch on.
 */
export async function createEmailFromUpload(
  _state: CreateEmailState,
  form: FormData
): Promise<CreateEmailState> {
  const started = Date.now()
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Only this workspace’s owner creates emails.' }
  if (!uploadCopyOn(process.env))
    return { error: 'Copying your own emails is not turned on yet.' }
  const parsed = uploadUseForm.safeParse({
    run: form.get('run'),
    slot: form.get('slot'),
    upload: form.get('upload')
  })
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((i) => i.path[0]))
    return {
      error: fields.has('upload')
        ? 'Choose one of your emails first.'
        : 'Choose a planned email.'
    }
  }
  const db = await createClient()
  if (!db) return { error: 'Creating emails is unavailable right now.' }
  const { data, error } = await db.rpc('create_email_build', {
    t: context.tenantId,
    run: parsed.data.run,
    slot: parsed.data.slot,
    mode: 'copy',
    upload: parsed.data.upload
  })
  const refused = refusal(error)
  if (refused) return refused
  if (typeof data !== 'string')
    return { error: 'We could not create the email. Try again.' }
  const made = await db
    .from('email_builds')
    .select('mode,reference_id,upload_id')
    .eq('id', data)
    .eq('tenant_id', context.tenantId)
    .maybeSingle()
  if (made.data && made.data.upload_id !== parsed.data.upload) {
    revalidatePath('/plan')
    return { error: alreadyMade }
  }
  buildSoon(started, data)
  revalidatePath('/plan')
  redirect(`/plan/email/${data}` as Route)
}

const createAllForm = z.object({ run: z.uuid() })

/** The command's refusals that hold for the whole plan, not one email. */
const wholePlan = /plan has been replaced|plan is not ready/

/**
 * PICK-102 (owner pick #102): "Create all emails" on the plan. Only the
 * workspace's owner starts it, as one "Create email" (D17). The server
 * reads the plan itself (never the page's list) and queues, through the
 * same `create_email_build` command, every planned email the Plan screen
 * offers "Create email" on: no build yet and its send time not passed. A
 * second click or tab queues nothing new (the command returns the open
 * build of each email). The emails are built one after another by the same
 * job, with every check, switch and limit of one click; each lands in
 * Klaviyo as a draft, nothing is scheduled or sent. Nothing is charged
 * here: each AI call reserves and records its own cost (`runAi`).
 */
export async function createAllEmails(
  _state: CreateEmailState,
  form: FormData
): Promise<CreateEmailState> {
  const started = Date.now()
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Only this workspace’s owner creates emails.' }
  const parsed = createAllForm.safeParse({ run: form.get('run') })
  if (!parsed.success) return { error: 'Reload the page to see your plan.' }
  const latest = await latestPlanRun(context.tenantId, context.timezone)
  if (!latest.ok) return { error: 'Creating emails is unavailable right now.' }
  const run = latest.run
  if (!run || run.id !== parsed.data.run)
    return {
      error: 'This plan has been replaced. Reload the page to see the latest.'
    }
  const view = planScreen(run, { owner: true })
  if (view.kind !== 'plan')
    return { error: 'This plan is not ready yet. Reload the page.' }
  const pick = pickSlots(view.emails)
  const db = await createClient()
  if (!db) return { error: 'Creating emails is unavailable right now.' }
  const result = await queueAll(pick.create, async (slot) => {
    // Scratch, the command's default, as one click without a choice.
    const { data, error } = await db.rpc('create_email_build', {
      t: context.tenantId,
      run: run.id,
      slot
    })
    return queueAnswer(data, error)
  })
  if (result.queued.length)
    buildSoon(started, ...result.queued.map((q) => q.build))
  revalidatePath('/plan')
  if (result.stopped && !result.queued.length) return { error: result.stopped }
  const agents = result.queued.length > 0 && emailAgentsReady(process.env)
  const words = createAllWords(view.emails, pick, result, {
    agents,
    allowanceUsed: agents && (await allowanceUsed(db, context.tenantId))
  })
  return result.queued.length || !result.refused.length
    ? { message: words }
    : { error: words }
}

/** One command answer for "Create all", in the owner's words. */
function queueAnswer(
  data: unknown,
  error: { code?: string; message?: string; hint?: string } | null
): QueueAnswer {
  if (error?.code === '42501')
    return { ok: false, stop: 'Only this workspace’s owner creates emails.' }
  if (error?.code === 'PT409' && wholePlan.test(error.message ?? ''))
    return {
      ok: false,
      stop: 'This plan has been replaced. Reload the page to see the latest.'
    }
  const refused = refusal(error)
  if (refused) return { ok: false, reason: refused.error ?? couldNot }
  return typeof data === 'string'
    ? { ok: true, build: data }
    : { ok: false, reason: couldNot }
}

/**
 * The workspace's AI allowance is used up (its active cycle): the agents'
 * calls are refused before anything is sent and each email falls back to
 * code (D16). Owners read their own cycle (RLS). Unknown: not said.
 */
async function allowanceUsed(
  db: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  tenantId: string
) {
  const { data, error } = await db
    .from('package_cycles')
    .select('allocation_micro,used_micro,reserved_micro')
    .eq('tenant_id', tenantId)
    .eq('state', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return false
  return data.used_micro + data.reserved_micro >= data.allocation_micro
}
