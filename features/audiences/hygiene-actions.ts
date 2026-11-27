'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { hygieneDayBounds } from './hygiene'

/**
 * PICK-101: the owner changes list hygiene on Audiences: its days (30 to
 * 730) or turns it off and on. Only the owner; the database command checks
 * the role again and the revision the page read (`set_list_hygiene`:
 * PT409 when another window changed it).
 */
const ownerOnly = 'Only the store’s owner can change who is left out.'
const reload = 'Reload the page and try again.'

const form = z.object({
  enabled: z.enum(['on', 'off']),
  days: z.coerce
    .number()
    .int()
    .min(hygieneDayBounds.min)
    .max(hygieneDayBounds.max),
  revision: z
    .string()
    .regex(/^\d{1,10}$/)
    .transform(Number)
    .pipe(z.number().max(1_000_000_000))
})

export async function saveListHygiene(
  _state: FormResult,
  data: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner') return { error: ownerOnly }
  const db = await createClient()
  if (!db || getServerEnvironment().AUTH_MODE === 'demo')
    return { error: 'Please sign in again.' }
  const parsed = form.safeParse({
    enabled: data.get('enabled'),
    days: data.get('days'),
    revision: data.get('revision')
  })
  if (!parsed.success)
    return parsed.error.issues.some((i) => i.path[0] === 'days')
      ? {
          error: `Type a number of days from ${hygieneDayBounds.min} to ${hygieneDayBounds.max}.`
        }
      : { error: reload }
  const { enabled, days, revision } = parsed.data
  const saved = await db.rpc('set_list_hygiene', {
    t: context.tenantId,
    hygiene_on: enabled === 'on',
    hygiene_days: days,
    expected_revision: revision
  })
  if (saved.error) {
    if (saved.error.code === 'PT409')
      return {
        error:
          'This changed in another window. Reload the page, then try again.'
      }
    if (saved.error.code === '42501') return { error: ownerOnly }
    if (saved.error.code === '23514')
      return {
        error: `Type a number of days from ${hygieneDayBounds.min} to ${hygieneDayBounds.max}.`
      }
    return { error: 'We could not save it. Nothing was changed.' }
  }
  revalidatePath('/audiences')
  return {
    message:
      enabled === 'on'
        ? `Saved. New emails leave out people with no clicks, site visits or orders in ${days} days.`
        : 'Saved. New emails leave out only people Klaviyo skips (bounced or suppressed).'
  }
}
