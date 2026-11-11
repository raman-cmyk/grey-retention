'use server'

import type { Route } from 'next'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/logger'
import { runEmailBuilds } from './worker'

export type CreateEmailState = { error?: string }

/** Builds this email right after the reply; the cron picks up the rest. */
function buildSoon(build: string) {
  after(async () => {
    const service = createServiceClient()
    if (!service) return
    try {
      await runEmailBuilds(service, { build })
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
    .pipe(z.int().min(0).max(19))
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
    slot: form.get('slot')
  })
  if (!parsed.success) return { error: 'Choose an email from the plan.' }
  const db = await createClient()
  if (!db) return { error: 'Creating emails is unavailable right now.' }
  const { data, error } = await db.rpc('create_email_build', {
    t: context.tenantId,
    run: parsed.data.run,
    slot: parsed.data.slot
  })
  if (error?.code === 'PT409' && /failed 5 times/.test(error.message ?? ''))
    return {
      error:
        'This email could not be made after 5 tries. Plan again for new emails.'
    }
  if (error?.code === 'PT409')
    return {
      error:
        'This email’s day has passed or the plan has changed. Plan again to create it.'
    }
  if (error?.code === '22023')
    return { error: 'This plan has no such email. Reload the page.' }
  if (error || typeof data !== 'string')
    return { error: 'We could not create the email. Try again.' }
  buildSoon(data)
  revalidatePath('/plan')
  redirect('/plan' as Route)
}
