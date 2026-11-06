'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { runFixtureJobs } from '@/features/integrations/worker'
import type { FormResult } from '@/components/ui/action-form'
import { resolveLocalTimeFields } from '@/lib/local-time'
const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('plan'),
    start: z.iso.datetime({ offset: true }),
    audience: z.uuid()
  }),
  z.object({
    kind: z.literal('preferences'),
    revision: z.coerce.number().int().positive(),
    weekly: z.coerce.number().int().min(1).max(5),
    discount: z.coerce.number().int().min(0).max(40),
    gap: z.coerce.number().int().min(7).max(60)
  }),
  z.object({ kind: z.literal('approve_plan'), id: z.uuid() }),
  z.object({ kind: z.enum(['queue_week', 'review_week']), week: z.iso.date() }),
  z.object({ kind: z.literal('approve_batch'), id: z.uuid() }),
  z.object({
    kind: z.literal('reject'),
    id: z.uuid(),
    revision: z.coerce.number().int().positive(),
    versionKind: z.enum(['copy', 'calendar']),
    reason: z.string().trim().min(5).max(5000),
    scope: z.enum(['single', 'sequence', 'audience']),
    phrase: z.string().trim().max(200)
  }),
  z.object({ kind: z.enum(['run', 'reminders']) })
])
export async function planningAction(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Brand owner permission required.' }
  // Picked times are workspace-local wall times; convert them with the
  // authorized workspace timezone before validation.
  const when = resolveLocalTimeFields(
    Object.fromEntries(form),
    ['start'],
    context.timezone
  )
  if (!when.ok) return { error: when.error }
  const p = schema.safeParse(when.values)
  if (!p.success)
    return { error: 'Check the fields, date and explicit review scope.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  try {
    const v = p.data,
      t = context.tenantId
    let r: { error: { message: string } | null } | undefined
    if (v.kind === 'plan')
      r = await db.rpc('enqueue_plan', {
        t,
        starts_at: v.start,
        audience: v.audience
      })
    if (v.kind === 'preferences')
      r = await db.rpc('set_planning_preferences', {
        t,
        expected_revision: v.revision,
        weekly: v.weekly,
        discounted: v.discount,
        gap: v.gap
      })
    if (v.kind === 'approve_plan')
      r = await db.rpc('approve_plan', { t, plan: v.id })
    if (v.kind === 'queue_week')
      r = await db.rpc('queue_weekly_copy', { t, week: v.week })
    if (v.kind === 'review_week')
      r = await db.rpc('prepare_copy_review', { t, week: v.week })
    if (v.kind === 'approve_batch')
      r = await db.rpc('approve_copy_batch', { t, batch: v.id })
    if (v.kind === 'reject')
      r = await db.rpc('reject_campaign_version', {
        t,
        campaign: v.id,
        kind: v.versionKind,
        expected_revision: v.revision,
        reason: v.reason,
        scope: v.scope,
        forbidden_phrase: v.phrase
      })
    if (v.kind === 'reminders')
      r = await db.rpc('enqueue_review_reminders', { t })
    if (v.kind === 'run') await runFixtureJobs(db, t)
    if (r?.error) return { error: r.error.message }
    for (const path of [
      '/campaign-agent',
      '/copy-review',
      '/campaigns',
      '/dashboard'
    ])
      revalidatePath(path, path === '/campaigns' ? 'layout' : 'page')
    return {
      message:
        v.kind === 'run'
          ? 'Fixture pass completed; inspect persisted state.'
          : v.kind === 'approve_batch'
            ? 'Exact reviewed versions approved atomically.'
            : 'Planning command saved.'
    }
  } catch {
    return { error: 'Planning operation unavailable; inspect job state.' }
  }
}
