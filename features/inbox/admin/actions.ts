'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/)
  .max(253)

const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('resolve_task'),
    task: z.uuid(),
    outcome: z.enum(['resolved', 'dismissed']),
    note: z.string().trim().max(500).optional()
  }),
  z.object({
    kind: z.literal('assign_sender'),
    sender: domain,
    brand: z.uuid()
  }),
  z.object({
    kind: z.literal('assign_message'),
    message: z.uuid(),
    brand: z.uuid()
  }),
  z.object({
    kind: z.literal('save_brand'),
    domain,
    alias: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
    name: z.string().trim().min(1).max(120),
    niche: z.string().trim().min(1).max(60),
    senders: z.string().trim().max(2000).optional()
  })
])

/** Plain words for what the database refused. */
function refusal(error: { code?: string; message?: string }) {
  if (error.code === '42501') return 'Only platform admins can do this.'
  if ((error.code === 'PT409' || error.code === '23514') && error.message)
    return error.message.endsWith('.') ? error.message : `${error.message}.`
  return 'That did not work. Reload the page and try again.'
}

/**
 * The admin inbox page's actions (INB-004): resolve or dismiss a task,
 * assign an email or a whole sender to a brand, add or edit a brand. A
 * platform admin session is checked here, and every command checks again
 * in the database.
 */
export async function inboxAdminAction(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  await requireRequestContext('admin')
  const parsed = schema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Check the fields and try again.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  const x = parsed.data
  let message = ''
  let error: { code?: string; message?: string } | null = null
  if (x.kind === 'resolve_task') {
    const r = await db.rpc('resolve_ops_task', {
      task: x.task,
      outcome: x.outcome,
      note: x.note || undefined
    })
    error = r.error
    message = x.outcome === 'resolved' ? 'Marked as done.' : 'Dismissed.'
  } else if (x.kind === 'assign_sender') {
    const r = await db.rpc('admin_assign_sender', {
      sender: x.sender,
      brand: x.brand
    })
    error = r.error
    message = `Assigned ${r.data ?? 0} ${r.data === 1 ? 'email' : 'emails'}. New emails from ${x.sender} go to this brand from now on.`
  } else if (x.kind === 'assign_message') {
    const r = await db.rpc('admin_assign_inbox_message', {
      message: x.message,
      brand: x.brand
    })
    error = r.error
    message = 'Assigned.'
  } else {
    const senders = (x.senders ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (senders.length > 10) return { error: 'At most 10 sender domains.' }
    const r = await db.rpc('admin_save_inbox_brand', {
      brand_domain: x.domain,
      alias: x.alias,
      name: x.name,
      brand_niche: x.niche,
      senders
    })
    error = r.error
    message = `Saved ${x.name}.`
  }
  if (error) return { error: refusal(error) }
  revalidatePath('/admin/inbox')
  return { message }
}
