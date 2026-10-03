'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { runFixtureJobs } from '@/features/integrations/worker'
const commands = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('subscribe'),
    domain: z
      .string()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9.-]*\.example$/)
      .max(200),
    label: z.string().min(2).max(120),
    rules: z.string().max(5000)
  }),
  z.object({
    kind: z.literal('update'),
    subscription: z.uuid(),
    revision: z.coerce.number().int().positive(),
    active: z.enum(['true', 'false']),
    rules: z.string().max(5000)
  }),
  z.object({ kind: z.literal('capture'), subscription: z.uuid() }),
  z.object({ kind: z.literal('playbook') }),
  z.object({ kind: z.literal('run') })
])
export async function referenceAction(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return {
      error: 'Only the owner manages capture subscriptions and playbooks.'
    }
  const parsed = commands.safeParse(Object.fromEntries(form))
  if (!parsed.success)
    return {
      error: 'Check fields; only fictional .example sources are available.'
    }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  try {
    const v = parsed.data
    let result: { error: { code?: string; message: string } | null } | undefined
    if (v.kind === 'subscribe')
      result = await db.rpc('subscribe_competitor', {
        t: context.tenantId,
        domain: v.domain,
        label: v.label,
        private_rules: v.rules
      })
    if (v.kind === 'update')
      result = await db.rpc('update_competitor_subscription', {
        t: context.tenantId,
        subscription: v.subscription,
        expected_revision: v.revision,
        active: v.active === 'true',
        private_rules: v.rules
      })
    if (v.kind === 'capture')
      result = await db.rpc('enqueue_reference_job', {
        t: context.tenantId,
        kind: 'competitors.capture',
        subscription: v.subscription
      })
    if (v.kind === 'playbook')
      result = await db.rpc('enqueue_reference_job', {
        t: context.tenantId,
        kind: 'playbook.synthesize'
      })
    if (v.kind === 'run') await runFixtureJobs(db, context.tenantId)
    if (result?.error)
      return {
        error: ['23514', 'PT409'].includes(result.error.code ?? '')
          ? result.error.message
          : 'Reference command denied or unavailable.'
      }
    for (const p of [
      '/competitor-agent',
      '/email-library',
      '/brand',
      '/connections',
      '/campaign-agent'
    ])
      revalidatePath(p)
    return {
      message:
        v.kind === 'run'
          ? 'Reference job pass completed. Inspect persisted evidence.'
          : ['capture', 'playbook'].includes(v.kind)
            ? 'Reference fixture intent queued. Run reference jobs to process it.'
            : 'Private subscription saved.'
    }
  } catch {
    return {
      error: 'Reference processing unavailable. Inspect job state and retry.'
    }
  }
}
