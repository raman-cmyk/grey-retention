'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import {
  canManageTeam,
  inviteSchema,
  memberChangeSchema,
  roleLabel
} from './rules'

const notAllowed = 'Only the owner or a manager can change the team.'

/** The signed-in owner or manager, before any input is read. */
async function managerSession() {
  const context = await requireRequestContext('client')
  if (!canManageTeam(context.tenantRole)) return { error: notAllowed } as const
  const db = await createClient()
  if (!db || getServerEnvironment().AUTH_MODE === 'demo')
    return { error: 'Please sign in again.' } as const
  return { context, db } as const
}

type DbError = { code?: string; message?: string }
const says = (error: DbError, text: string) =>
  (error.message ?? '').startsWith(text)

function failed(error: DbError): FormResult {
  if (error.code === 'PT409') {
    if (says(error, 'Already a member'))
      return { error: 'This person is already on the team.' }
    if (says(error, 'Already invited'))
      return {
        error:
          'This person already has an invite. Use Resend in the list below.'
      }
    if (says(error, 'This invite was cancelled or accepted'))
      return {
        error: 'This invite was already cancelled or accepted. Reload the page.'
      }
    return {
      error:
        'Someone changed this in another window. Reload the page and try again.'
    }
  }
  if (error.code === '42501') {
    if (says(error, 'The owner'))
      return { error: 'The owner’s access cannot be changed here.' }
    if (says(error, 'You cannot change your own access'))
      return {
        error: 'You cannot change your own access. Ask the owner.'
      }
    if (says(error, 'Member unavailable') || says(error, 'Invite unavailable'))
      return { error: 'This is no longer on your team. Reload the page.' }
    return { error: notAllowed }
  }
  if (error.code === '23514')
    return { error: 'Check the details and try again.' }
  return { error: 'We could not save this. Nothing was changed. Try again.' }
}

const refresh = () => revalidatePath('/team')
const text = (form: FormData, key: string) => {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

/** "Send invite". Email delivery is simulated: nothing is sent. */
export async function inviteTeammate(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await managerSession()
  if ('error' in session) return { error: session.error }
  const parsed = inviteSchema.safeParse({
    email: text(form, 'email'),
    role: text(form, 'role')
  })
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Check the invite.' }
  const { context, db } = session
  const saved = await db.rpc('invite_team', {
    t: context.tenantId,
    email: parsed.data.email,
    role: parsed.data.role
  })
  if (saved.error) return failed(saved.error)
  refresh()
  return {
    message: `Invite saved for ${parsed.data.email} as ${roleLabel[parsed.data.role]}. Email sending is not switched on yet, so no email was sent.`
  }
}

const inviteTarget = z.object({ id: z.uuid() })

/** "Resend": a new link and 7 more days (no email is sent yet). */
export async function resendInvite(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await managerSession()
  if ('error' in session) return { error: session.error }
  const picked = inviteTarget.safeParse({ id: form.get('id') })
  if (!picked.success) return { error: 'Reload the page and try again.' }
  const { context, db } = session
  const saved = await db.rpc('resend_team_invite', {
    t: context.tenantId,
    invite: picked.data.id
  })
  if (saved.error) return failed(saved.error)
  refresh()
  return {
    message: 'Invite renewed for 7 more days. No email was sent.'
  }
}

/** "Cancel" on a pending invite. */
export async function cancelInvite(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await managerSession()
  if ('error' in session) return { error: session.error }
  const picked = inviteTarget.safeParse({ id: form.get('id') })
  if (!picked.success) return { error: 'Reload the page and try again.' }
  const { context, db } = session
  const saved = await db.rpc('revoke_team_invite', {
    t: context.tenantId,
    invite: picked.data.id
  })
  if (saved.error) return failed(saved.error)
  refresh()
  return { message: 'Invite cancelled.' }
}

/**
 * Change a teammate's role, or deactivate / reactivate them, after the
 * person confirmed. `name` is only used for the message.
 */
export async function changeMember(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await managerSession()
  if ('error' in session) return { error: session.error }
  const parsed = memberChangeSchema.safeParse({
    id: form.get('id'),
    updatedAt: form.get('updatedAt'),
    role: form.get('role'),
    status: form.get('status')
  })
  if (!parsed.success) return { error: 'Reload the page and try again.' }
  const v = parsed.data
  const { context, db } = session
  const saved = await db.rpc('change_team_member', {
    t: context.tenantId,
    membership: v.id,
    expected_at: v.updatedAt,
    role: v.role,
    status: v.status
  })
  if (saved.error) return failed(saved.error)
  refresh()
  const who = text(form, 'name').trim().slice(0, 200) || 'Your teammate'
  const change = text(form, 'change')
  return {
    message:
      change === 'deactivate'
        ? `${who} was deactivated.`
        : change === 'reactivate'
          ? `${who} was reactivated.`
          : `${who} is now ${v.role === 'admin' ? 'a Manager' : 'Staff'}.`
  }
}
