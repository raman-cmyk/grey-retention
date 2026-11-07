import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { latestThreadId } from '@/features/gros/data'
import { validChatId } from '@/features/gros/model'
import { GrosWorkspace } from '@/features/gros/workspace'

export const metadata: Metadata = { title: 'Ask GROS' }

/**
 * /gros opens the most recent chat (OWNER_JOURNEYS §8); a workspace with no
 * chats sees a new one. Old `?chat=` links still work.
 */
export default async function GrosPage({
  searchParams
}: {
  searchParams: Promise<{ chat?: string }>
}) {
  const { chat } = await searchParams
  const legacy = validChatId(chat)
  if (legacy) redirect(`/gros/${legacy}`)
  const ctx = await requireRequestContext('client')
  const latest = await latestThreadId(ctx)
  if (latest) redirect(`/gros/${latest}`)
  return <GrosWorkspace ctx={ctx} />
}
