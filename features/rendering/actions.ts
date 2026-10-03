'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('render'),
    id: z.uuid(),
    copy: z.coerce.number().int().positive(),
    design: z.coerce.number().int().positive(),
    source: z.enum([
      'fixture_structure',
      'own_template',
      'reference_structure'
    ]),
    sourceId: z
      .string()
      .transform((v) => v || undefined)
      .pipe(z.uuid().optional())
  }),
  z.object({
    kind: z.literal('review'),
    id: z.uuid(),
    revision: z.coerce.number().int().positive(),
    decision: z.enum(['revision', 'approved']),
    section: z.enum(['hero', 'copy', 'cta', 'whole_design']),
    feedback: z.string().trim().max(5000)
  })
])
export async function renderAction(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Brand owner review required.' }
  const p = schema.safeParse(Object.fromEntries(form))
  if (!p.success)
    return { error: 'Choose a structure or exact design section.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  const v = p.data,
    r =
      v.kind === 'render'
        ? await db.rpc('enqueue_render', {
            t: context.tenantId,
            campaign: v.id,
            expected_copy: v.copy,
            expected_design: v.design,
            source: v.source,
            source_id: v.sourceId
          })
        : await db.rpc('review_render', {
            t: context.tenantId,
            render: v.id,
            expected_revision: v.revision,
            decision: v.decision,
            section: v.section,
            feedback: v.feedback
          })
  if (r.error) return { error: r.error.message }
  revalidatePath('/campaigns', 'layout')
  revalidatePath('/campaign-agent')
  return {
    message:
      v.kind === 'render'
        ? 'Original fixture render queued. Run campaign fixture jobs.'
        : 'Exact design review saved.'
  }
}
