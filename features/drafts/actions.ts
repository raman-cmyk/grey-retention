'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { z } from 'zod'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { resolveLocalTime } from '@/lib/local-time'

const schema = z.object({
  requestKey: z.uuid(),
  source: z.string().max(100),
  title: z.string().trim().min(2).max(200),
  goal: z.string().trim().min(5).max(5000),
  plannedLocal: z.string().max(20),
  occurrence: z.enum(['', 'earlier', 'later']),
  audience: z.uuid().or(z.literal('')),
  channel: z.enum(['email_design', 'email_text'])
})
export async function createFirstDraft(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Ask your workspace owner to create this draft.' }
  const parsed = schema.safeParse(Object.fromEntries(form))
  if (!parsed.success)
    return {
      error:
        'Add a title, a short goal and a valid date. Check your selections and try again.'
    }
  const x = parsed.data
  let planned: string
  try {
    planned = resolveLocalTime(x.plannedLocal, context.timezone, x.occurrence)
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : 'Choose a valid date and time.'
    }
  }
  const source = x.source === 'original' ? 'original' : 'reference_structure'
  const sourceId = source === 'original' ? undefined : x.source
  if (source === 'reference_structure' && !z.uuid().safeParse(sourceId).success)
    return { error: 'Choose an available reference or start from scratch.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Sign in through Supabase to save a draft.' }
  const result = await db.rpc('create_first_draft', {
    t: context.tenantId,
    request_key: x.requestKey,
    source,
    source_id: sourceId,
    input: {
      title: x.title,
      goal: x.goal,
      channel: x.channel,
      planned_at: planned,
      audience_id: x.audience,
      product_id: '',
      offer_id: '',
      reference_notes: ''
    }
  })
  if (result.error || !result.data)
    return {
      error:
        result.error?.code === 'PT409'
          ? 'This request already saved a different draft. Open your workspace to continue it, or start a new draft.'
          : result.error?.code === '42501'
            ? 'This source is no longer available. Choose another reference or start from scratch.'
            : result.error?.code === '23514'
              ? 'Choose a future date and check the draft details.'
              : 'We could not save this draft. Your inputs are still here; try again.'
    }
  for (const path of ['/get-started', '/campaign-agent', '/dashboard'])
    revalidatePath(path)
  redirect(`/campaigns/${result.data}` as Route)
}
