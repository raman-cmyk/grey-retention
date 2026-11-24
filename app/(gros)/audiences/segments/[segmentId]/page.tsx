import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { segmentDetail } from '@/features/audiences/detail'
import { SegmentScreen } from '@/features/audiences/detail-screen'
import { segmentHref } from '@/features/audiences/screen'

export const metadata: Metadata = { title: 'Segment' }

/** A Klaviyo segment's own page under Audiences (UI-AUDc). */
export default async function SegmentPage({
  params
}: {
  params: Promise<{ segmentId: string }>
}) {
  const { segmentId } = await params
  const context = await requireRequestContext('client')
  const view = await segmentDetail(context, segmentId)
  if (view.state === 'not_found') notFound()
  return (
    <SegmentScreen
      view={view}
      owner={context.tenantRole === 'owner'}
      href={segmentHref(segmentId)}
    />
  )
}
