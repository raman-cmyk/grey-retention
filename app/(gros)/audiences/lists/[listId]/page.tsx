import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { listDetail } from '@/features/audiences/detail'
import { ListScreen } from '@/features/audiences/detail-screen'
import { listHref } from '@/features/audiences/screen'

export const metadata: Metadata = { title: 'List' }

/** A Klaviyo list's own page under Audiences (UI-AUDc). */
export default async function ListPage({
  params
}: {
  params: Promise<{ listId: string }>
}) {
  const { listId } = await params
  const context = await requireRequestContext('client')
  const view = await listDetail(context, listId)
  if (view.state === 'not_found') notFound()
  return (
    <ListScreen
      view={view}
      owner={context.tenantRole === 'owner'}
      href={listHref(listId)}
    />
  )
}
