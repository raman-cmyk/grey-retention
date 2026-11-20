'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/components/gros/action'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { setBrandHidden } from '@/features/onboarding/suggested-competitors'
import { defaultBrandPresentation } from '@/lib/branding/presentation'
import { createClient } from '@/lib/supabase/server'

/**
 * The brand's name, for the answer only: never trusted for anything and
 * never a reason to refuse the hide. Anything that is not text is dropped,
 * and a long name (a domain can be 253 characters) is cut to 120 whole
 * characters, so an emoji is never split.
 */
function answerName(value: unknown) {
  if (typeof value !== 'string') return undefined
  return Array.from(value.trim()).slice(0, 120).join('') || undefined
}

const hideForm = z.object({
  capture: z.uuid(),
  name: z.unknown().optional().transform(answerName)
})

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
  // Said in the card's answer place, which stays when the row leaves.
  const brand = parsed.data.name || 'this brand'
  return {
    message: `Hidden. ${defaultBrandPresentation.assistantName} won’t suggest ${brand} again.`
  }
}
