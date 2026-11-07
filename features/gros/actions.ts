'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'

const question = z.string().trim().min(1).max(5000)
const optionalCampaign = z
  .union([z.uuid(), z.literal('')])
  .optional()
  .transform((v) => v || null)

/** Plain words for every refusal; never the raw database error. */
function grosError(e: unknown, fallback: string): FormResult {
  const x = e as { code?: string; message?: string }
  if (x.code === 'PT409')
    return {
      error: x.message || 'This changed in another window. Reload the page.'
    }
  if (x.code === '42501')
    return {
      error: x.message?.startsWith('Only the person')
        ? `${x.message}.`
        : 'You can’t open or change this chat.'
    }
  if (x.code === '23514')
    return {
      error: /budget|credit|usage/i.test(x.message ?? '')
        ? 'Your AI credits for GROS are used up for now. Nothing was saved.'
        : x.message?.startsWith('Choose') ||
            x.message?.startsWith('A chat name') ||
            x.message?.startsWith('Type')
          ? `${x.message}.`
          : 'GROS can’t do that for this campaign right now. Nothing was saved.'
    }
  return { error: fallback }
}

async function session() {
  const ctx = await requireRequestContext('client')
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo') return null
  return { ctx, db }
}

const done = (chat?: string) => {
  revalidatePath('/gros', 'layout')
  if (chat) revalidatePath(`/gros/${chat}`)
}

/** A new chat, saved together with its first question (never empty). */
export async function startChat(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const parsed = z
    .object({
      question,
      campaign: optionalCampaign,
      visibility: z.enum(['private', 'shared']).default('private')
    })
    .safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Type a question first.' }
  const s = await session()
  if (!s) return { error: 'Sign in again to ask GROS.' }
  const { data, error } = await s.db.rpc('start_conversation', {
    t: s.ctx.tenantId,
    question: parsed.data.question,
    campaign: parsed.data.campaign ?? undefined,
    visibility: parsed.data.visibility
  })
  if (error || !data)
    return grosError(
      error,
      'GROS could not answer. Nothing was saved. Try again.'
    )
  done()
  redirect(`/gros/${data}`)
}

/** A question in an existing chat; about the workspace or one campaign. */
export async function sendMessage(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const parsed = z
    .object({ chat: z.uuid(), question, campaign: optionalCampaign })
    .safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Type a question first.' }
  const s = await session()
  if (!s) return { error: 'Sign in again to ask GROS.' }
  const { error } = await s.db.rpc('ask_fixture_gros', {
    t: s.ctx.tenantId,
    chat: parsed.data.chat,
    campaign: parsed.data.campaign as string,
    question: parsed.data.question,
    intent: 'explain',
    value: ''
  })
  if (error)
    return grosError(
      error,
      'GROS could not answer. Your question was not saved. Try again.'
    )
  done(parsed.data.chat)
  return { message: 'Sent.' }
}

const proposalSchema = z.object({
  chat: z.uuid(),
  campaign: z.uuid(),
  intent: z.enum([
    'edit_goal',
    'select_reference',
    'schedule',
    'cancel',
    'request_assignment'
  ]),
  question: question,
  value: z.string().trim().max(5000).default('')
})

/** Ask GROS to propose one change; nothing changes until it is confirmed. */
export async function proposeChange(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const parsed = proposalSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Choose a campaign and say why.' }
  const v = parsed.data
  if (v.intent === 'edit_goal' && !v.value)
    return { error: 'Type the new goal.' }
  if (v.intent === 'select_reference' && !z.uuid().safeParse(v.value).success)
    return { error: 'Choose a reference email.' }
  const s = await session()
  if (!s) return { error: 'Sign in again to ask GROS.' }
  if (
    ['schedule', 'cancel', 'request_assignment'].includes(v.intent) &&
    s.ctx.tenantRole !== 'owner'
  )
    return { error: 'Only the workspace owner can ask for this change.' }
  const { error } = await s.db.rpc('ask_fixture_gros', {
    t: s.ctx.tenantId,
    chat: v.chat,
    campaign: v.campaign,
    question: v.question,
    intent: v.intent,
    value: v.value
  })
  if (error)
    return grosError(error, 'GROS could not save the proposal. Try again.')
  done(v.chat)
  revalidatePath('/campaigns', 'layout')
  return {
    message: 'GROS proposed the change. Nothing changes until you apply it.'
  }
}

/** Apply or dismiss a proposal: only the person who asked for it. */
export async function decideProposal(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const parsed = z
    .object({
      chat: z.uuid(),
      proposal: z.uuid(),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      decision: z.enum(['confirmed', 'rejected'])
    })
    .safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Reload the page and try again.' }
  const s = await session()
  if (!s) return { error: 'Sign in again to ask GROS.' }
  const { error } = await s.db.rpc('decide_chat_proposal', {
    t: s.ctx.tenantId,
    proposal: parsed.data.proposal,
    expected_hash: parsed.data.hash,
    decision: parsed.data.decision
  })
  if (error)
    return error.code === '42501'
      ? {
          error:
            'Only the person who asked for this change can apply or dismiss it.'
        }
      : grosError(error, 'The change could not be saved. Try again.')
  done(parsed.data.chat)
  revalidatePath('/campaigns', 'layout')
  revalidatePath('/campaign-agent')
  return {
    message:
      parsed.data.decision === 'confirmed'
        ? 'Applied to the campaign.'
        : 'Dismissed. Nothing changed.'
  }
}

/** Rename on blur or Enter: only the person who started the chat. */
export async function renameChat(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const parsed = z
    .object({ chat: z.uuid(), title: z.string().trim().min(1).max(200) })
    .safeParse(Object.fromEntries(form))
  if (!parsed.success)
    return { error: 'A chat name needs 1 to 200 characters.' }
  const s = await session()
  if (!s) return { error: 'Sign in again to rename this chat.' }
  const { data, error } = await s.db.rpc('rename_conversation', {
    t: s.ctx.tenantId,
    chat: parsed.data.chat,
    title: parsed.data.title
  })
  if (error) return grosError(error, 'The new name was not saved. Try again.')
  if (data === false) return {}
  done(parsed.data.chat)
  return { message: 'Renamed.' }
}

/** Private ⇄ shared: only the person who started the chat. */
export async function setVisibility(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const parsed = z
    .object({ chat: z.uuid(), visibility: z.enum(['private', 'shared']) })
    .safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Reload the page and try again.' }
  const s = await session()
  if (!s) return { error: 'Sign in again to change this chat.' }
  const { error } = await s.db.rpc('set_conversation_visibility', {
    t: s.ctx.tenantId,
    chat: parsed.data.chat,
    visibility: parsed.data.visibility
  })
  if (error)
    return error.code === '42501'
      ? {
          error: 'Only the person who started this chat can change who sees it.'
        }
      : grosError(error, 'Who can see this chat did not change. Try again.')
  done(parsed.data.chat)
  return {
    message:
      parsed.data.visibility === 'shared'
        ? 'Shared. Your workspace team can read this chat now.'
        : 'Private. Only you can see this chat now.'
  }
}

/** Delete a chat with its messages: only the person who started it. */
export async function deleteChat(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const parsed = z
    .object({ chat: z.uuid() })
    .safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Reload the page and try again.' }
  const s = await session()
  if (!s) return { error: 'Sign in again to delete this chat.' }
  const { error } = await s.db.rpc('delete_conversation', {
    t: s.ctx.tenantId,
    chat: parsed.data.chat
  })
  if (error) return grosError(error, 'The chat was not deleted. Try again.')
  done(parsed.data.chat)
  redirect('/gros')
}

/**
 * "Refresh data": GROS reads campaigns from the database on every answer,
 * and Klaviyo and Shopify are sample connections here, so there is nothing
 * new to pull. This re-reads the page and says so honestly.
 */
export async function refreshData(
  _: FormResult,
  form: FormData
): Promise<FormResult> {
  const chat = z.uuid().safeParse(form.get('chat'))
  await requireRequestContext('client')
  done(chat.success ? chat.data : undefined)
  return {
    message:
      'Up to date. GROS reads your campaigns fresh for every answer. Klaviyo and Shopify are sample connections here, so there is nothing new to pull.'
  }
}
