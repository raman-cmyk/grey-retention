'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { runFixtureJobs } from '@/features/integrations/worker'
const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('clock'),
    observedAt: z.iso.datetime({ offset: true })
  }),
  z.object({ kind: z.enum(['run', 'learn']) }),
  z.object({
    kind: z.literal('rule'),
    id: z.uuid(),
    revision: z.coerce.number().int().positive(),
    decision: z.enum(['pinned', 'dismissed'])
  }),
  z.object({
    kind: z.literal('metrics'),
    id: z.uuid(),
    scenario: z.enum(['complete', 'partial', 'incomparable'])
  }),
  z.object({
    kind: z.literal('l2_policy'),
    revision: z.coerce.number().int().nonnegative(),
    enabled: z.enum(['true', 'false']),
    required: z.coerce.number().int().min(1).max(100)
  }),
  z.object({
    kind: z.literal('silence_prepare'),
    id: z.uuid(),
    revision: z.coerce.number().int().positive()
  }),
  z.object({
    kind: z.literal('silence_apply'),
    id: z.uuid(),
    observedAt: z.iso.datetime({ offset: true })
  }),
  z.object({
    kind: z.literal('l2_schedule'),
    id: z.uuid(),
    package: z.uuid(),
    revision: z.coerce.number().int().positive()
  })
])
export async function reportingAction(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const ctx = await requireRequestContext('client')
  if (ctx.tenantRole !== 'owner')
    return { error: 'Brand owner permission required.' }
  const v = schema.safeParse(Object.fromEntries(form))
  if (!v.success)
    return { error: 'Check fields and include a timezone in dates.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  try {
    const x = v.data
    let r
    if (x.kind === 'clock')
      r = await db.rpc('advance_results_clock', {
        t: ctx.tenantId,
        observed_at: x.observedAt
      })
    if (x.kind === 'learn')
      r = await db.rpc('enqueue_learning', { t: ctx.tenantId })
    if (x.kind === 'rule')
      r = await db.rpc('review_learned_rule', {
        t: ctx.tenantId,
        rule: x.id,
        expected_revision: x.revision,
        decision: x.decision
      })
    if (x.kind === 'metrics')
      r = await db.rpc('set_fixture_metrics', {
        t: ctx.tenantId,
        delivery: x.id,
        scenario: x.scenario
      })
    if (x.kind === 'l2_policy')
      r = await db.rpc('save_l2_simulation_policy', {
        t: ctx.tenantId,
        expected_revision: x.revision,
        enabled: x.enabled === 'true',
        required_sends: x.required
      })
    if (x.kind === 'silence_prepare')
      r = await db.rpc('prepare_l2_silence', {
        t: ctx.tenantId,
        campaign: x.id,
        expected_copy: x.revision
      })
    if (x.kind === 'silence_apply')
      r = await db.rpc('simulate_l2_silence', {
        t: ctx.tenantId,
        candidate: x.id,
        observed_at: x.observedAt
      })
    if (x.kind === 'l2_schedule')
      r = await db.rpc('simulate_l2_schedule', {
        t: ctx.tenantId,
        candidate: x.id,
        package: x.package,
        expected_delivery: x.revision
      })
    if (r?.error) throw r.error
    if (['clock', 'learn', 'run'].includes(x.kind))
      await runFixtureJobs(db, ctx.tenantId)
    revalidatePath('/reports')
    revalidatePath('/campaigns', 'layout')
    revalidatePath('/settings')
    revalidatePath('/dashboard')
    return {
      message:
        'Synthetic reporting operation persisted. No measured revenue, real send or paid AI.'
    }
  } catch (e) {
    const x = e as { code?: string; message?: string }
    return {
      error:
        x.code === '40001'
          ? 'Exact version, evidence or policy changed. Refresh and review again.'
          : x.code === '23514'
            ? x.message
            : x.code === '42501'
              ? 'Permission denied.'
              : 'Reporting operation failed; inspect durable job status.'
    }
  }
}
