'use server'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { requestSchema } from './rules'

const text = (form: FormData, key: string) => {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

/** "Send" in the Request a Feature modal. Any workspace member may send. */
export async function sendFeatureRequest(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client')
  const db = await createClient()
  if (!db || getServerEnvironment().AUTH_MODE === 'demo')
    return {
      error:
        'Feature requests are unavailable right now. Your text is still here.'
    }
  const parsed = requestSchema.safeParse({
    category: text(form, 'category'),
    subject: text(form, 'subject'),
    details: text(form, 'details')
  })
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Check the request.' }
  const saved = await db.rpc('request_feature', {
    t: context.tenantId,
    category: parsed.data.category,
    subject: parsed.data.subject,
    details: parsed.data.details
  })
  if (saved.error) {
    if (saved.error.code === '42501')
      return {
        error:
          'You can no longer send requests for this workspace. Reload the page.'
      }
    if (saved.error.code === '23514')
      return { error: 'Check the subject and details, then try again.' }
    return { error: 'We could not send this. Nothing was saved. Try again.' }
  }
  revalidatePath('/feedback')
  return { message: 'Thanks — your request was sent.' }
}
