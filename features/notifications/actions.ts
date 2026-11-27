'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import type { ActionResult } from '@/components/gros/action'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { safeNoticeHref } from './view'

/**
 * PICK-107: what a person does with their notices. Marking read is theirs
 * only (the database marks the caller's own rows); the email switch is the
 * owner's (checked here and again by `set_notification_email`).
 */
const unavailable = 'Notifications are unavailable right now. Try again.'
const ownerOnly = 'Only the workspace owner can turn notification emails on.'

/** "Mark all read" on the Notifications page. */
export async function markAllNoticesRead(): Promise<ActionResult> {
  const context = await requireRequestContext('client')
  const db = await createClient()
  if (!db) return { error: unavailable }
  const { data, error } = await db.rpc('mark_notifications_read', {
    t: context.tenantId
  })
  if (error) return { error: 'We could not mark them read. Try again.' }
  revalidatePath('/notifications')
  return {
    message:
      data === 0 ? 'Nothing new to mark.' : 'Done. Every notification is read.'
  }
}

/**
 * "Open" on one notice: marks it read for this person, then opens its page
 * (a page of this app only). A notice that is gone opens the list again.
 */
export async function openNotice(form: FormData): Promise<void> {
  const context = await requireRequestContext('client')
  const id = z.uuid().safeParse(form.get('notice'))
  if (!id.success) redirect('/notifications')
  const db = await createClient()
  if (!db) redirect('/notifications')
  const { data } = await db
    .from('notifications')
    .select('href')
    .eq('tenant_id', context.tenantId)
    .eq('id', id.data)
    .not('event_key', 'is', null)
    .maybeSingle()
  if (!data) redirect('/notifications')
  await db.rpc('mark_notifications_read', {
    t: context.tenantId,
    ids: [id.data]
  })
  redirect(safeNoticeHref(data.href))
}

/** "Turn on emails" and "Turn off emails": the owner's switch. */
export async function setNoticeEmail(
  _state: ActionResult,
  form: FormData
): Promise<ActionResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner') return { error: ownerOnly }
  const turn = form.get('turn')
  if (turn !== 'on' && turn !== 'off')
    return { error: 'Open Notifications again, then try again.' }
  const db = await createClient()
  if (!db) return { error: unavailable }
  const { error } = await db.rpc('set_notification_email', {
    t: context.tenantId,
    turn_on: turn === 'on'
  })
  if (error)
    return {
      error:
        error.code === '42501'
          ? ownerOnly
          : 'We could not change it. Nothing was changed.'
    }
  revalidatePath('/notifications')
  return {
    message:
      turn === 'on'
        ? 'Emails are on. This build records each one but sends none yet.'
        : 'Emails are off. Notifications stay in the app.'
  }
}
