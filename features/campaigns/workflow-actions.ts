'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { httpsUrl } from '@/features/workflow/domain/contracts'
import { runFixtureJobs } from '@/features/integrations/worker'
import type { FormResult } from '@/components/ui/action-form'
const base = { id: z.uuid(), revision: z.coerce.number().int().positive() }
const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['generate_copy', 'approve_copy', 'schedule', 'cancel']),
    ...base
  }),
  z.object({ kind: z.literal('run_jobs') }),
  z.object({
    kind: z.literal('save_copy'),
    ...base,
    subject: z.string().trim().min(1).max(200),
    preheader: z.string().max(300),
    body: z.string().trim().min(1).max(20000),
    cta: z.string().trim().min(1).max(200),
    url: httpsUrl
  }),
  z.object({
    kind: z.literal('package'),
    ...base,
    address: z.string().trim().min(5).max(1000),
    senderName: z.string().trim().min(1).max(200),
    senderEmail: z.email(),
    unsubscribeUrl: httpsUrl,
    privacyUrl: httpsUrl
  }),
  z.object({
    kind: z.literal('review_design'),
    ...base,
    decision: z.enum(['revision', 'approved']),
    section: z.string().trim().min(1).max(200),
    feedback: z.string().trim().max(5000)
  })
])
export async function workflowAction(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client')
  const parsed = schema.safeParse(Object.fromEntries(form))
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Check the fields.' }
  const v = parsed.data
  if (v.kind !== 'save_copy' && context.tenantRole !== 'owner')
    return { error: 'Brand owner permission required.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Configured Supabase authentication required.' }
  try {
    let result: { error: { code?: string; message?: string } | null } | null =
      null
    if (v.kind === 'generate_copy')
      result = await db.rpc('enqueue_copy', {
        t: context.tenantId,
        campaign: v.id,
        expected_revision: v.revision
      })
    if (v.kind === 'approve_copy')
      result = await db.rpc('approve_copy', {
        t: context.tenantId,
        campaign: v.id,
        expected_revision: v.revision
      })
    if (v.kind === 'save_copy')
      result = await db.rpc('save_copy', {
        t: context.tenantId,
        campaign: v.id,
        expected_revision: v.revision,
        input: {
          subject: v.subject,
          preheader: v.preheader,
          body: v.body,
          cta: v.cta,
          url: v.url
        }
      })
    if (v.kind === 'package')
      result = await db.rpc('create_delivery_package', {
        t: context.tenantId,
        campaign: v.id,
        expected_revision: v.revision,
        settings: {
          address: v.address,
          senderName: v.senderName,
          senderEmail: v.senderEmail,
          unsubscribeUrl: v.unsubscribeUrl,
          privacyUrl: v.privacyUrl
        }
      })
    if (v.kind === 'schedule')
      result = await db.rpc('enqueue_delivery', {
        t: context.tenantId,
        package: v.id,
        expected_revision: v.revision
      })
    if (v.kind === 'cancel')
      result = await db.rpc('enqueue_cancel', {
        t: context.tenantId,
        campaign: v.id,
        expected_revision: v.revision
      })
    if (v.kind === 'review_design')
      result = await db.rpc('review_design', {
        t: context.tenantId,
        submission: v.id,
        expected_revision: v.revision,
        decision: v.decision,
        section: v.section,
        feedback: v.feedback
      })
    if (v.kind === 'run_jobs') {
      const processed = await runFixtureJobs(db, context.tenantId)
      revalidatePath('/campaigns', 'layout')
      revalidatePath('/dashboard')
      revalidatePath('/campaign-agent')
      return {
        message: `Processed ${processed} fixture job${processed === 1 ? '' : 's'}. Inspect persisted status below.`
      }
    }
    if (result?.error) throw result.error
    revalidatePath('/campaigns', 'layout')
    revalidatePath('/dashboard')
    revalidatePath('/campaign-agent')
    return {
      message: ['schedule', 'cancel', 'generate_copy'].includes(v.kind)
        ? 'Intent queued. Run fixture jobs to obtain a confirmed outcome.'
        : 'Versioned change saved.'
    }
  } catch (error) {
    const e = error as { code?: string; message?: string }
    return {
      error:
        e.code === 'PT409'
          ? 'This version or lease changed. Refresh and review again.'
          : e.code === '42501'
            ? 'Permission denied.'
            : e.code === '23514'
              ? e.message
              : 'Operation failed. Inspect persisted job status and retry after resolving the cause.'
    }
  }
}
