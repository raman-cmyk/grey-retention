import type { Metadata } from 'next'
import { defaultAssistant } from '@/components/gros/nav'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { BrandNote } from '@/features/gros/brand-note'
import { validMessageCursor } from '@/features/gros/params'
import { askReadModel } from '@/features/gros/read-model'
import { AskScreen } from '@/features/gros/screen'

export const metadata: Metadata = { title: `Ask ${defaultAssistant}` }

/**
 * Ask GROS (UI-ASK): replaces the old chat page at the same address. The
 * `chat` and `before` parameters are checked before any read.
 */
export default async function AskPage({
  searchParams
}: {
  searchParams: Promise<{
    chat?: string | string[]
    before?: string | string[]
  }>
}) {
  const [context, params] = await Promise.all([
    requireRequestContext('client'),
    searchParams
  ])
  const view = await askReadModel(context, {
    chat: params.chat,
    before: validMessageCursor(params.before)
  })
  return (
    <AskScreen
      view={view}
      brandNote={
        <BrandNote
          tenantId={context.tenantId}
          action={`${defaultAssistant} answers`}
        />
      }
    />
  )
}
