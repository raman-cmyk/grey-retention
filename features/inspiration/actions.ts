'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/components/gros/action'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { setBrandHidden } from '@/features/onboarding/suggested-competitors'
import { createClient } from '@/lib/supabase/server'

const hideForm = z.object({ capture: z.uuid() })

/**
 * Hide a suggested brand (REAL-01a, the owner's rule of 16 November: the
 * owner can hide any brand). Owner only; the database checks again and
 * keeps the hide to this workspace. Hiding also stops following it.
 */
export async function hideBrand(
  _state: ActionResult,
  form: FormData
): Promise<ActionResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Only the workspace owner can hide a brand.' }
  const parsed = hideForm.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Reload the page and try again.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Please sign in again.' }
  try {
    await setBrandHidden(db, context.tenantId, parsed.data.capture, true)
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    // The database's own refusals, in the owner's words.
    if (code === '42501')
      return { error: 'Only the workspace owner can hide a brand.' }
    if (code === '23514')
      return {
        error: 'That brand is no longer suggested. Open Inspiration again.'
      }
    return { error: 'That brand could not be hidden. Try again.' }
  }
  revalidatePath('/inspiration')
  return {}
}
