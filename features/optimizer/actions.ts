'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { runFixtureJobs } from '@/features/integrations/worker'
const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['install', 'run']) }),
  z.object({
    kind: z.literal('preview'),
    observedAt: z.iso.datetime({ offset: true })
  }),
  z.object({
    kind: z.literal('approve'),
    id: z.uuid(),
    revision: z.coerce.number().int().positive()
  }),
  z.object({
    kind: z.literal('clock'),
    id: z.uuid(),
    observedAt: z.iso.datetime({ offset: true })
  }),
  z.object({
    kind: z.literal('reverse'),
    id: z.uuid(),
    revision: z.coerce.number().int().positive()
  }),
  z.object({
    kind: z.literal('evidence'),
    id: z.uuid(),
    revision: z.coerce.number().int().positive(),
    consent: z.enum(['subscribed', 'unsubscribed', 'pending']),
    bounce: z.enum(['true', 'false']),
    spam: z.enum(['true', 'false']),
    recentOrder: z.enum(['true', 'false'])
  })
])
export async function optimizerAction(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const ctx = await requireRequestContext('client')
  if (ctx.tenantRole !== 'owner') return { error: 'Owner permission required.' }
  const v = schema.safeParse(Object.fromEntries(form))
  if (!v.success) return { error: 'Check fixture operation fields.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  try {
    const x = v.data
    let r
    if (x.kind === 'install')
      r = await db.rpc('install_optimizer_fixture', { t: ctx.tenantId })
    if (x.kind === 'preview')
      r = await db.rpc('preview_optimizer', {
        t: ctx.tenantId,
        observed_at: x.observedAt
      })
    if (x.kind === 'approve')
      r = await db.rpc('approve_optimizer', {
        t: ctx.tenantId,
        sweep: x.id,
        expected_revision: x.revision
      })
    if (x.kind === 'clock')
      r = await db.rpc('advance_optimizer_clock', {
        t: ctx.tenantId,
        sweep: x.id,
        observed_at: x.observedAt
      })
    if (x.kind === 'reverse')
      r = await db.rpc('reverse_fixture_suppression', {
        t: ctx.tenantId,
        profile: x.id,
        expected_revision: x.revision
      })
    if (x.kind === 'evidence')
      r = await db.rpc('change_fixture_profile_evidence', {
        t: ctx.tenantId,
        profile: x.id,
        expected_revision: x.revision,
        consent: x.consent,
        bounce: x.bounce === 'true',
        spam: x.spam === 'true',
        recent_order: x.recentOrder === 'true'
      })
    if (r?.error) throw r.error
    if (['clock', 'run'].includes(x.kind))
      await runFixtureJobs(db, ctx.tenantId)
    if (x.kind === 'clock')
      for (let n = 0; n < 2; n++) {
        const advanced = await db.rpc('advance_optimizer_clock', {
          t: ctx.tenantId,
          sweep: x.id,
          observed_at: x.observedAt
        })
        if (advanced.error) throw advanced.error
        await runFixtureJobs(db, ctx.tenantId)
      }
    revalidatePath('/optimizer')
    return {
      message:
        'Fixture optimizer operation persisted. No real message, suppression or billing change.'
    }
  } catch (e) {
    const x = e as { code?: string; message?: string }
    return {
      error:
        x.code === '40001'
          ? 'Preview or profile changed. Refresh and review again.'
          : x.code === '23514'
            ? x.message
            : x.code === '42501'
              ? 'Permission denied.'
              : 'Fixture optimizer failed; inspect durable jobs.'
    }
  }
}
