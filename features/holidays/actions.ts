'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { readEntryForm } from './entries'
import { isHolidayCountry } from './platform'

async function ownerSession() {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return {
      error: 'Only the workspace owner can change holidays and events.'
    } as const
  const db = await createClient()
  if (!db || getServerEnvironment().AUTH_MODE === 'demo')
    return {
      error: 'Please sign in again. Your changes are still here.'
    } as const
  return { context, db } as const
}

function failed(error: { code?: string; message?: string }): FormResult {
  const text = error.message ?? ''
  if (error.code === 'PT409')
    return {
      error: text.startsWith('This entry was removed')
        ? 'This entry was removed in another window. Reload the page.'
        : 'This entry changed in another window. Reload the page to see it, then try again.'
    }
  if (error.code === '42501')
    return { error: 'Only the workspace owner can change holidays and events.' }
  if (error.code === '23514') return { error: 'Check the entry and try again.' }
  return { error: 'We could not save this. Nothing was changed. Try again.' }
}

function refresh() {
  for (const path of ['/holidays', '/calendar', '/campaign-agent'])
    revalidatePath(path)
}

/** "Add entry" and "Save" on an existing entry. */
export async function saveHoliday(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const parsed = readEntryForm(form)
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Check the entry.' }
  const v = parsed.data
  const { context, db } = session
  const saved = await db.rpc('save_holiday', {
    t: context.tenantId,
    // null adds a new entry; the generated type omits null.
    holiday_id: v.id as string,
    expected_revision: v.revision,
    name: v.name,
    event_date: v.date,
    kind: v.kind,
    repeats_annually: v.repeatsAnnually,
    notes: v.notes
  })
  if (saved.error) return failed(saved.error)
  refresh()
  return { message: v.id ? 'Saved.' : `Added “${v.name}”.` }
}

const target = z.object({
  id: z.uuid(),
  revision: z.string().regex(/^\d+$/).transform(Number)
})

/** Delete one entry (after the owner confirms). */
export async function deleteHoliday(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const picked = target.safeParse({
    id: form.get('id'),
    revision: form.get('revision')
  })
  if (!picked.success) return { error: 'Reload the page and try again.' }
  const { context, db } = session
  const removed = await db.rpc('delete_holiday', {
    t: context.tenantId,
    holiday_id: picked.data.id,
    expected_revision: picked.data.revision
  })
  if (removed.error) return failed(removed.error)
  refresh()
  return { message: 'Deleted.' }
}

/** Which country's platform holidays the workspace sees. */
export async function setHolidayCountry(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const country = form.get('country')
  if (typeof country !== 'string' || !isHolidayCountry(country))
    return { error: 'Choose a country from the list.' }
  const { context, db } = session
  const saved = await db.rpc('set_holiday_country', {
    t: context.tenantId,
    country
  })
  if (saved.error) return failed(saved.error)
  refresh()
  return { message: 'Country saved.' }
}
