import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { metricDetail } from '@/features/klaviyo-detail/detail'
import { MetricScreen } from '@/features/klaviyo-detail/detail-screen'
import { metricHref } from '@/features/klaviyo-detail/hrefs'

export const metadata: Metadata = { title: 'Metric' }

/** A Klaviyo metric's own page under Results (UI-KLV). */
export default async function MetricPage({
  params
}: {
  params: Promise<{ metricId: string }>
}) {
  const { metricId } = await params
  const context = await requireRequestContext('client')
  const view = await metricDetail(context, metricId)
  if (view.state === 'not_found') notFound()
  return (
    <MetricScreen
      view={view}
      owner={context.tenantRole === 'owner'}
      href={metricHref(metricId)}
    />
  )
}
