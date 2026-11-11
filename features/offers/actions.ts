'use server'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { parseCode, parseExpiry, parsePercent } from './fields'

const editorsOnly = 'Only the owner or an admin can change offers.'

type Rpc = {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): PromiseLike<{
    data: unknown
    error: { code?: string; message?: string } | null
  }>
}

async function editorSession() {
  const context = await requireRequestContext('client')
  if (!['owner', 'admin'].includes(context.tenantRole))
    return { error: editorsOnly } as const
  const db = await createClient()
  if (!db || getServerEnvironment().AUTH_MODE === 'demo')
    return { error: 'Please sign in again.' } as const
  return { context, db: db as unknown as Rpc } as const
}

const refresh = () => revalidatePath('/settings')

/** "Save max discount" in Settings. */
export async function saveMaxDiscount(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await editorSession()
  if ('error' in session) return { error: session.error }
  const percent = parsePercent(form.get('percent'), 0)
  const revision = Number(form.get('revision'))
  if (percent === null) return { error: 'Enter a whole number from 0 to 100.' }
  if (!Number.isInteger(revision) || revision < 0)
    return { error: 'Reload the page and try again.' }
  const { error } = await session.db.rpc('set_max_discount', {
    t: session.context.tenantId,
    percent,
    expected_revision: revision
  })
  if (error) {
    if (error.code === 'PT409')
      return {
        error:
          'The max discount changed in another window. Reload the page, then try again.'
      }
    if (error.code === '42501') return { error: editorsOnly }
    return { error: 'We could not save the max discount. Nothing was changed.' }
  }
  refresh()
  return {
    message:
      percent === 0
        ? 'Saved. New emails will not offer a discount.'
        : `Saved. New emails offer at most ${percent}% off.`
  }
}

/** "Add code" in Settings. */
export async function addDiscountCode(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await editorSession()
  if ('error' in session) return { error: session.error }
  const code = parseCode(form.get('code'))
  const percent = parsePercent(form.get('percent'), 1)
  const expiry = parseExpiry(form.get('expires'), session.context.timezone)
  if (!code)
    return {
      error:
        'Enter the code exactly as it works in your store: 3 to 40 letters, numbers, - or _.'
    }
  if (percent === null) return { error: 'Enter a whole percent from 1 to 100.' }
  if (expiry === undefined) return { error: 'Choose a valid end date.' }
  const { error } = await session.db.rpc('add_discount_code', {
    t: session.context.tenantId,
    code,
    percent,
    expires_at: expiry
  })
  if (error) {
    if (error.code === 'PT409')
      return {
        error:
          error.message === 'Too many codes'
            ? 'You have 200 codes. Remove one you no longer use first.'
            : `${code} is already in your list.`
      }
    if (error.code === '23514')
      return {
        error: expiry
          ? 'That end date has passed. Choose a later one.'
          : 'Check the code and the percent.'
      }
    if (error.code === '42501') return { error: editorsOnly }
    return { error: 'We could not add the code. Nothing was changed.' }
  }
  refresh()
  return { message: `Added ${code}. Agents can use it in new emails.` }
}

/** "Remove" next to a code. Emails already made keep their code. */
export async function retireDiscountCode(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await editorSession()
  if ('error' in session) return { error: session.error }
  const id = form.get('id')
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return { error: 'Reload the page and try again.' }
  const { error } = await session.db.rpc('retire_discount_code', {
    code_id: id
  })
  if (error)
    return {
      error:
        error.code === '42501'
          ? editorsOnly
          : 'We could not remove the code. Nothing was changed.'
    }
  refresh()
  return { message: 'Removed. New emails will not use it.' }
}
