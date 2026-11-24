'use server'

import type { Route } from 'next'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { Database } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/logger'
import { draftPusherFor } from '@/features/klaviyo-push/live'
import { runEmailBuilds } from './worker'

export type CreateEmailState = { error?: string }

/**
 * Time the click gives this email's steps (the plan page allows 120 s);
 * with the agents on, a step starts only while a whole step fits, and the
 * cron sweep (code only) runs the rest.
 */
const clickBudgetMs = 110_000

/** Builds this email right after the reply; the cron picks up the rest. */
function buildSoon(build: string) {
  after(async () => {
    const service = createServiceClient()
    if (!service) return
    try {
      // The fake draft pusher unless the owner's write switch is on
      // (KLAVIYO_DRAFT_PUSH=live with KLAVIYO_MODE=live, PSH-001).
      await runEmailBuilds(service, {
        build,
        deadline: Date.now() + clickBudgetMs,
        pusher: draftPusherFor(service)
      })
    } catch (error) {
      logger.error('Email build could not start', {
        code: (error as { code?: string }).code ?? 'email_build_error'
      })
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
  buildSoon(data)
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
  // BUILD_LEDGER Known issues): the one place it is named by hand.
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
  buildSoon(data)
  revalidatePath('/plan')
  redirect(`/plan/email/${data}` as Route)
}

type CreateEmailBuildArgs =
  Database['public']['Functions']['create_email_build']['Args']
