'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import type { FormResult } from '@/components/ui/action-form'
import { httpsUrl } from '@/features/workflow/domain/contracts'
import { resolveLocalTimeFields } from '@/lib/local-time'
const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('policy'),
    revision: z.coerce.number().int().nonnegative(),
    level: z.enum(['L0', 'L1']),
    enabled: z.enum(['true', 'false']),
    senderName: z.string().trim().min(1).max(200),
    senderEmail: z.email(),
    address: z.string().trim().min(5).max(1000),
    unsubscribeUrl: httpsUrl,
    privacyUrl: httpsUrl
  }),
  z.object({
    kind: z.literal('fault'),
    id: z.uuid(),
    scenario: z.enum([
      'none',
      'transient_once',
      'rate_limit_once',
      'auth_permanent',
      'validation_permanent',
      'timeout_after_success',
      'unknown_reconcile',
      'cancel_rejected'
    ])
  }),
  z.object({
    kind: z.literal('reschedule'),
    id: z.uuid(),
    revision: z.coerce.number().int().positive(),
    scheduledAt: z.iso.datetime({ offset: true })
  }),
  z.object({
    kind: z.literal('sent'),
    id: z.uuid(),
    observedAt: z.iso.datetime({ offset: true })
  }),
  z.object({ kind: z.enum(['retry', 'resolve']), id: z.uuid() })
])
export async function deliveryAction(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const ctx = await requireRequestContext('client')
  if (ctx.tenantRole !== 'owner')
    return { error: 'Brand owner permission required.' }
  // Picked times are workspace-local wall times; convert them with the
  // authorized workspace timezone before validation.
  const when = resolveLocalTimeFields(
    Object.fromEntries(form),
    ['scheduledAt'],
    ctx.timezone
  )
  if (!when.ok) return { error: when.error }
  const v = schema.safeParse(when.values)
  if (!v.success)
    return { error: 'Check the fields; include a timezone in dates.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  try {
    const x = v.data
    let r
    if (x.kind === 'policy')
      r = await db.rpc('save_delivery_policy', {
        t: ctx.tenantId,
        expected_revision: x.revision,
        level: x.level,
        enabled: x.enabled === 'true',
        defaults: {
          senderName: x.senderName,
          senderEmail: x.senderEmail,
          address: x.address,
          unsubscribeUrl: x.unsubscribeUrl,
          privacyUrl: x.privacyUrl
        }
      })
    if (x.kind === 'fault')
      r = await db.rpc('set_fixture_fault', {
        t: ctx.tenantId,
        campaign: x.id,
        scenario: x.scenario
      })
    if (x.kind === 'reschedule')
      r = await db.rpc('request_reschedule', {
        t: ctx.tenantId,
        campaign: x.id,
        expected_revision: x.revision,
        scheduled_at: x.scheduledAt
      })
    if (x.kind === 'sent')
      r = await db.rpc('confirm_fixture_sent', {
        t: ctx.tenantId,
        delivery: x.id,
        observed_at: x.observedAt
      })
    if (x.kind === 'retry')
      r = await db.rpc('retry_fixture_job', { t: ctx.tenantId, job: x.id })
    if (x.kind === 'resolve')
      r = await db.rpc('resolve_fixture_outcome', {
        t: ctx.tenantId,
        job: x.id
      })
    if (r?.error) throw r.error
    revalidatePath('/settings')
    revalidatePath('/campaigns', 'layout')
    revalidatePath('/campaign-agent')
    revalidatePath('/dashboard')
    return {
      message:
        x.kind === 'reschedule'
          ? 'Reschedule intent queued; wait for provider confirmation.'
          : x.kind === 'sent'
            ? 'Synthetic send confirmed; own template saved. No real recipient was contacted.'
            : x.kind === 'policy'
              ? 'Owner standing policy saved. Run fixture jobs to dispatch ready packages.'
              : 'Fixture operation saved.'
    }
  } catch (e) {
    const x = e as { code?: string; message?: string }
    return {
      error:
        x.code === 'PT409'
          ? 'This version changed. Refresh and review again.'
          : x.code === '42501'
            ? 'Permission denied.'
            : x.code === '23514'
              ? x.message
              : 'Fixture operation failed.'
    }
  }
}
