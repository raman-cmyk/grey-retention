import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { learnedReadModel } from '@/features/learned/read-model'
import { LearnedScreen } from '@/features/learned/screen'

export const metadata: Metadata = { title: 'Learned' }

/** Learned (UI-LRNb): what the agents learned, with the owner's Remove and Pin. */
export default async function LearnedPage() {
  const context = await requireRequestContext('client')
  return <LearnedScreen view={await learnedReadModel(context)} />
}
