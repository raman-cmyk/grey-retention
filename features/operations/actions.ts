'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { z } from 'zod'
import type { FormResult } from '@/components/ui/action-form'
import {
  requireRequestContext,
  activeTenantCookieName
} from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
// Team changes live in features/team (UIR-019).
const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('holiday'),
    name: z.string().trim().min(2).max(200),
    date: z.iso.date(),
    notes: z.string().max(2000)
  }),
  z.object({
    kind: z.literal('open_ticket'),
    ticketKind: z.enum(['support', 'feedback']),
    subject: z.string().trim().min(2).max(200),
    body: z.string().trim().min(1).max(5000)
  }),
  z.object({
    kind: z.literal('reply_ticket'),
    id: z.uuid(),
    tenant: z.uuid(),
    revision: z.coerce.number().int().positive(),
    body: z.string().trim().min(1).max(5000),
    state: z.enum(['open', 'in_progress', 'closed'])
  }),
  z.object({
    kind: z.literal('define_package'),
    name: z.string().trim().min(2).max(200),
    allocation: z.coerce.number().int().min(1000).max(1000000000),
    daily: z.coerce.number().int().min(1000).max(1000000000)
  }),
  z.object({
    kind: z.literal('assign_package'),
    tenant: z.uuid(),
    package: z.uuid()
  })
])
export async function operationAction(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const surface = form.get('surface') === 'admin' ? 'admin' : 'client',
    ctx = await requireRequestContext(surface),
    v = schema.safeParse(Object.fromEntries(form))
  if (!v.success) return { error: 'Check the operation fields.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  const x = v.data
  const t = ctx.kind === 'client' ? ctx.tenantId : 'tenant' in x ? x.tenant : ''
  try {
    let r
    if (x.kind === 'holiday')
      r = await db.rpc('add_holiday', {
        t,
        name: x.name,
        event_date: x.date,
        notes: x.notes
      })
    if (x.kind === 'open_ticket')
      r = await db.rpc('open_support_ticket', {
        t,
        kind: x.ticketKind,
        subject: x.subject,
        body: x.body
      })
    if (x.kind === 'reply_ticket')
      r = await db.rpc('reply_support', {
        t,
        ticket: x.id,
        expected_revision: x.revision,
        body: x.body,
        state: x.state
      })
    if (x.kind === 'define_package')
      r = await db.rpc('define_fixture_package', {
        name: x.name,
        allocation: x.allocation,
        daily: x.daily
      })
    if (x.kind === 'assign_package')
      r = await db.rpc('assign_fixture_package', { t, package: x.package })
    if (r?.error) throw r.error
    for (const path of ['/team', '/settings', '/support', '/admin/operations'])
      revalidatePath(path)
    return {
      message:
        'Authorized operation persisted. External delivery and billing remain simulated.'
    }
  } catch (e) {
    const v = e as { code?: string; message?: string }
    return {
      error:
        v.code === '42501'
          ? 'Permission denied.'
          : v.code === 'PT409'
            ? 'This version changed. Refresh before retrying.'
            : v.code === '23514'
              ? v.message
              : v.code === '23505'
                ? 'An open invitation or definition already exists.'
                : 'Operation could not be saved.'
    }
  }
}
export async function acceptInvite(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const id = z.uuid().safeParse(form.get('id'))
  if (!id.success) return { error: 'Invalid invitation.' }
  const db = await createClient()
  if (!db) return { error: 'Sign in to accept your invitation.' }
  const r = await db.rpc('accept_team_invite', { invite: id.data })
  if (r.error || !r.data)
    return {
      error: 'Invitation is unavailable for your verified account email.'
    }
  ;(await cookies()).set(activeTenantCookieName, r.data, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  })
  redirect('/dashboard')
}
