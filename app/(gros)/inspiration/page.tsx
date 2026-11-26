import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import {
  inspirationReadModel,
  selectionOf
} from '@/features/inspiration/read-model'
import { InspirationScreen } from '@/features/inspiration/screen'

export const metadata: Metadata = { title: 'Inspiration' }

/**
 * Inspiration (UI-INSa): replaces the old library of inspirations.
 * GROS-INS-002: ?source=niche lists the emails of brands like the store,
 * ?show=design or text one kind, and ?brand= one brand's.
 */
export default async function InspirationPage({
  searchParams
}: {
  searchParams: Promise<{
    source?: string | string[]
    show?: string | string[]
    brand?: string | string[]
  }>
}) {
  const [context, params] = await Promise.all([
    requireRequestContext('client'),
    searchParams
  ])
  return (
    <InspirationScreen
      view={await inspirationReadModel(context, selectionOf(params))}
      timezone={context.timezone}
    />
  )
}
