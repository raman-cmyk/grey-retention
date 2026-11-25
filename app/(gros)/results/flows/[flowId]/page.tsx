import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { flowDetail } from '@/features/klaviyo-detail/detail'
import { FlowScreen } from '@/features/klaviyo-detail/detail-screen'
import { flowHref } from '@/features/klaviyo-detail/hrefs'

export const metadata: Metadata = { title: 'Flow' }

/** A Klaviyo flow's own page under Results (UI-KLV). */
export default async function FlowPage({
  params
}: {
  params: Promise<{ flowId: string }>
}) {
  const { flowId } = await params
  const context = await requireRequestContext('client')
  const view = await flowDetail(context, flowId)
  if (view.state === 'not_found') notFound()
  return (
    <FlowScreen
      view={view}
      owner={context.tenantRole === 'owner'}
      href={flowHref(flowId)}
    />
  )
}
