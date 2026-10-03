'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create'),
    title: z.string().trim().min(1).max(200),
    visibility: z.enum(['private', 'shared'])
  }),
  z.object({
    kind: z.literal('visibility'),
    chat: z.uuid(),
    visibility: z.enum(['private', 'shared'])
  }),
  z.object({
    kind: z.literal('ask'),
    chat: z.uuid(),
    campaign: z.uuid(),
    question: z.string().trim().min(1).max(5000),
    intent: z.enum([
      'explain',
      'edit_goal',
      'select_reference',
      'schedule',
      'cancel',
      'request_assignment'
    ]),
    value: z.string().max(5000)
  }),
  z.object({
    kind: z.literal('decide'),
    proposal: z.uuid(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(['confirmed', 'rejected'])
  })
])
export async function grosAction(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const ctx = await requireRequestContext('client'),
    parsed = schema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Check the conversation fields.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  let newChat: string | null = null
  try {
    const v = parsed.data
    if (
      v.kind === 'ask' &&
      v.intent === 'select_reference' &&
      !z.uuid().safeParse(v.value).success
    )
      return {
        error: 'Choose a valid UUID from the authorized reference choices.'
      }
    let r
    if (v.kind === 'create') {
      const result = await db.rpc('create_conversation', {
        t: ctx.tenantId,
        title: v.title,
        visibility: v.visibility
      })
      r = result
      newChat = result.data
    }
    if (v.kind === 'visibility')
      r = await db.rpc('set_conversation_visibility', {
        t: ctx.tenantId,
        chat: v.chat,
        visibility: v.visibility
      })
    if (v.kind === 'ask')
      r = await db.rpc('ask_fixture_gros', {
        t: ctx.tenantId,
        chat: v.chat,
        campaign: v.campaign,
        question: v.question,
        intent: v.intent,
        value: v.value
      })
    if (v.kind === 'decide')
      r = await db.rpc('decide_chat_proposal', {
        t: ctx.tenantId,
        proposal: v.proposal,
        expected_hash: v.hash,
        decision: v.decision
      })
    if (r?.error) throw r.error
    revalidatePath('/gros')
    revalidatePath('/campaigns', 'layout')
    revalidatePath('/campaign-agent')
  } catch (e) {
    const x = e as { code?: string; message?: string }
    return {
      error:
        x.code === 'PT409'
          ? x.message
          : x.code === '42501'
            ? 'Conversation or proposal permission denied.'
            : x.code === '23514'
              ? x.message
              : 'GROS request could not be saved.'
    }
  }
  if (newChat) redirect(`/gros?chat=${newChat}`)
  return {
    message:
      'Conversation operation persisted. Inspect its exact proposal and campaign state.'
  }
}
