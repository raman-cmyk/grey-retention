'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { can } from '@/features/workflow/domain/policy'
import { createClient } from '@/lib/supabase/server'
import type { FormResult } from '@/components/ui/action-form'
import { campaignInputSchema, revisionSchema } from './schema'

async function access(ownerOnly = false) {
  const context = await requireRequestContext('client')
  if (!can(context, ownerOnly ? 'approve' : 'edit_draft', context.tenantId))
    throw new Error('Owner approval required.')
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    throw new Error('Sign in through configured Supabase authentication.')
  return { context, db }
}
function failure(error: unknown): FormResult {
  const e = error as { code?: string; message?: string }
  if (e.code === 'PT409')
    return { error: 'This version changed. Refresh before trying again.' }
  if (e.code === '42501')
    return { error: 'You do not have permission for this action.' }
  if (e.code === '23514')
    return { error: e.message ?? 'Required campaign inputs are missing.' }
  return {
    error:
      error instanceof z.ZodError
        ? 'Check the fields and enter a future date with a timezone.'
        : error instanceof Error
          ? error.message
          : 'Could not save this change. Refresh and retry.'
  }
}
export async function saveCampaign(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  let id: string
  try {
    const { context, db } = await access()
    const input = campaignInputSchema.parse({
      title: form.get('title'),
      goal: form.get('goal'),
      channel: form.get('channel'),
      planned_at: form.get('planned_at'),
      audience_id: form.get('audience_id'),
      product_id: form.get('product_id'),
      offer_id: form.get('offer_id'),
      reference_notes: form.get('reference_notes')
    })
    const target = z
      .uuid()
      .nullable()
      .parse(form.get('id') || null)
    const revision = revisionSchema.parse(form.get('revision'))
    const { data, error } = await db.rpc('save_campaign', {
      t: context.tenantId,
      target_id: target ?? undefined,
      expected_revision: revision,
      input
    })
    if (error || !data) throw error ?? new Error('Campaign save failed.')
    id = data
  } catch (e) {
    return failure(e)
  }
  revalidatePath('/campaign-agent')
  revalidatePath('/dashboard')
  revalidatePath(`/campaigns/${id}`)
  redirect(`/campaigns/${id}` as Route)
}
export async function approveCalendar(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  try {
    const { context, db } = await access(true)
    const id = z.uuid().parse(form.get('id'))
    const expected_revision = revisionSchema.parse(form.get('revision'))
    const { error } = await db.rpc('approve_calendar', {
      t: context.tenantId,
      target_id: id,
      expected_revision
    })
    if (error) throw error
    revalidatePath(`/campaigns/${id}`)
    revalidatePath('/campaign-agent')
    revalidatePath('/dashboard')
    return { message: 'Calendar version approved.' }
  } catch (e) {
    return failure(e)
  }
}
export async function addNote(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  try {
    const { context, db } = await access()
    const id = z.uuid().parse(form.get('id'))
    const body = z.string().trim().min(1).max(5000).parse(form.get('body'))
    const { error } = await db.rpc('add_campaign_note', {
      t: context.tenantId,
      target_id: id,
      body
    })
    if (error) throw error
    revalidatePath(`/campaigns/${id}`)
    return { message: 'Note saved.' }
  } catch (e) {
    return failure(e)
  }
}
