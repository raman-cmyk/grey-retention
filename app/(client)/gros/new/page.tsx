import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { GrosWorkspace } from '@/features/gros/workspace'

export const metadata: Metadata = { title: 'New chat · Ask GROS' }

/** A new private chat; nothing is saved until the first question. */
export default async function NewGrosChatPage() {
  const ctx = await requireRequestContext('client')
  return <GrosWorkspace ctx={ctx} />
}
