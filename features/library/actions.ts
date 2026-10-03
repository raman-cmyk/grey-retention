'use server'
import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { z } from 'zod'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
const schema = z.object({
  source: z.enum(['own_template', 'reference_structure']),
  sourceId: z.uuid(),
  title: z.string().trim().min(2).max(200),
  goal: z.string().max(5000),
  plannedAt: z.iso.datetime({ offset: true }),
  audience: z.uuid(),
  channel: z.enum(['email_design', 'email_text'])
})
export async function libraryDraftAction(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const ctx = await requireRequestContext('client')
  if (ctx.tenantRole !== 'owner') return { error: 'Owner permission required.' }
  const v = schema.safeParse(Object.fromEntries(form))
  if (!v.success)
    return {
      error: 'Select a permitted source, audience and future timestamp.'
    }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  const x = v.data
  const r = await db.rpc('draft_from_structure', {
    t: ctx.tenantId,
    source: x.source,
    source_id: x.sourceId,
    input: {
      title: x.title,
      goal: x.goal,
      channel: x.channel,
      planned_at: x.plannedAt,
      audience_id: x.audience
    }
  })
  if (r.error)
    return {
      error:
        r.error.code === '42501'
          ? 'Source unavailable in your workspace.'
          : r.error.code === '23514'
            ? r.error.message
            : 'Draft could not be created.'
    }
  redirect(`/campaigns/${r.data}` as Route)
}
