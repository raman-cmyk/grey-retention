import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { flowEmailDetail } from '@/features/klaviyo-detail/detail'
import { FlowEmailScreen } from '@/features/klaviyo-detail/detail-screen'
import { flowEmailHref } from '@/features/klaviyo-detail/hrefs'

export const metadata: Metadata = { title: 'Flow email' }

/** One flow email's own page under Results (UI-KLV). */
export default async function FlowEmailPage({
  params
}: {
  params: Promise<{ messageId: string }>
}) {
  const { messageId } = await params
  const context = await requireRequestContext('client')
  const view = await flowEmailDetail(context, messageId)
  if (view.state === 'not_found') notFound()
  return (
    <FlowEmailScreen
      view={view}
      owner={context.tenantRole === 'owner'}
      href={flowEmailHref(messageId)}
    />
  )
}
