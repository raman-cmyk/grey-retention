'use server'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { isKnownTimezone } from '@/lib/brand-time'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'

const ownerOnly = 'Only the workspace owner can change the brand timezone.'

async function ownerSession() {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner') return { error: ownerOnly } as const
  const db = await createClient()
  if (!db || getServerEnvironment().AUTH_MODE === 'demo')
    return { error: 'Please sign in again.' } as const
  return { context, db } as const
}

function failed(error: { code?: string }): FormResult {
  if (error.code === 'PT409')
    return {
      error:
        'The timezone changed in another window. Reload the page, then try again.'
    }
  if (error.code === '42501') return { error: ownerOnly }
  if (error.code === '23514')
    return { error: 'Choose a timezone from the list.' }
  return { error: 'We could not save the timezone. Nothing was changed.' }
}

/** Every page shows times in this timezone, so all of them refresh. */
const refresh = () => revalidatePath('/', 'layout')

/** "Save timezone" in Settings. */
export async function saveBrandTimezone(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const timezone = form.get('timezone')
  const expected = form.get('expected')
  if (typeof timezone !== 'string' || !isKnownTimezone(timezone))
    return { error: 'Choose a timezone from the list.' }
  if (typeof expected !== 'string' || !expected)
    return { error: 'Reload the page and try again.' }
  const { context, db } = session
  const saved = await db.rpc('set_brand_timezone', {
    t: context.tenantId,
    timezone,
    expected
  })
  if (saved.error) return failed(saved.error)
  refresh()
  return {
    message: `Saved. Every date and time now uses ${timezone}.`
  }
}

/** "Use Klaviyo's timezone" in Settings. */
export async function switchToKlaviyoTimezone(): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const { context, db } = session
  const saved = await db.rpc('use_klaviyo_timezone', { t: context.tenantId })
  if (saved.error)
    return saved.error.code === 'PT409'
      ? { error: 'Klaviyo has not reported a timezone. Reconnect Klaviyo.' }
      : failed(saved.error)
  refresh()
  return { message: 'Saved. The brand timezone now follows Klaviyo.' }
}
