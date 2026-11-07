import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { validChatId, validMessageCursor } from '@/features/gros/model'
import { GrosWorkspace } from '@/features/gros/workspace'

export const metadata: Metadata = { title: 'Ask GROS' }

/** One chat; `?before=` pages back through older messages. */
export default async function GrosChatPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ before?: string }>
}) {
  const [{ id }, { before }] = await Promise.all([params, searchParams])
  const chatId = validChatId(id)
  if (!chatId) notFound()
  const ctx = await requireRequestContext('client')
  return (
    <GrosWorkspace
      ctx={ctx}
      chatId={chatId}
      before={validMessageCursor(before)}
    />
  )
}
