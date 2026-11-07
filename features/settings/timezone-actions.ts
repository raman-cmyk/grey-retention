'use server'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { isKnownTimezone } from '@/lib/brand-time'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'

const ownerOnly = 'Only the workspace owner can change the brand timezone.'

/** What changes, said the same way after every save. */
const keepsPlanned =
  'New plans use it. Campaigns already planned still send at the same moment.'

async function ownerSession() {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner') return { error: ownerOnly } as const
  const db = await createClient()
  if (!db || getServerEnvironment().AUTH_MODE === 'demo')
    return { error: 'Please sign in again.' } as const
  return { context, db } as const
}

/** A timezone name from the form (never longer than any real one). */
function zoneField(form: FormData, name: string) {
  const value = form.get(name)
  return typeof value === 'string' && value !== '' && value.length <= 64
    ? value
    : null
}

function failed(error: { code?: string; message?: string }): FormResult {
  if (error.code === 'PT409') {
    if (error.message === 'GROS is making a plan')
      return {
        error:
          'GROS is making a plan right now. Try again when the plan is ready. Nothing was changed.'
      }
    if (error.message === 'Klaviyo reported another timezone')
      return {
        error:
          'Klaviyo reported another timezone since this page opened. Reload the page to see it.'
      }
    if (error.message === 'Klaviyo has not reported a timezone')
      return {
        error: 'Klaviyo has not reported a timezone. Reconnect Klaviyo.'
      }
    return {
      error:
        'The timezone changed in another window. Reload the page, then try again.'
    }
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
  const timezone = zoneField(form, 'timezone')
  const expected = zoneField(form, 'expected')
  if (!timezone || !isKnownTimezone(timezone))
    return { error: 'Choose a timezone from the list.' }
  if (!expected) return { error: 'Reload the page and try again.' }
  const { context, db } = session
  const saved = await db.rpc('set_brand_timezone', {
    t: context.tenantId,
    timezone,
    expected
  })
  if (saved.error) return failed(saved.error)
  // The database still checks for a stale page first; false means the
  // brand already had this timezone.
  if (saved.data === false)
    return {
      message: `${timezone} is already the brand timezone. Nothing changed.`
    }
  refresh()
  return {
    message: `Saved. The brand timezone is now ${timezone}. ${keepsPlanned}`
  }
}

/**
 * "Use Klaviyo's timezone" in Settings, naming both timezones the page
 * showed (Klaviyo's and the brand's).
 */
export async function switchToKlaviyoTimezone(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const zone = zoneField(form, 'klaviyoTimezone')
  const expected = zoneField(form, 'expected')
  if (!zone || !expected) return { error: 'Reload the page and try again.' }
  const { context, db } = session
  const saved = await db.rpc('use_klaviyo_timezone', {
    t: context.tenantId,
    expected_zone: zone,
    expected
  })
  if (saved.error) return failed(saved.error)
  refresh()
  return {
    message: `Saved. The brand timezone is now Klaviyo’s, ${zone}. ${keepsPlanned}`
  }
}
