import { BarChart3 } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { AdvancedDetails, DetailHero } from '@/components/ui/detail-page'
import { formatBrandDate } from '@/lib/brand-time'
import { formatCount } from '@/features/klaviyo-data/summary'
import {
  InfoCard,
  KlaviyoDetail,
  loadKlaviyo,
  NotConnected
} from '@/features/klaviyo-detail/parts'

export default async function MetricPage({
  params,
  searchParams
}: {
  params: Promise<{ metricId: string }>
  searchParams: Promise<{ from?: string | string[] }>
}) {
  const [{ metricId }, { from }, { timezone, data }] = await Promise.all([
    params,
    searchParams,
    loadKlaviyo()
  ])
  if (data.state !== 'sample') return <NotConnected from={from} data={data} />
  const metric = data.snapshot.metrics.find((m) => m.id === metricId)
  if (!metric) notFound()
  return (
    <KlaviyoDetail from={from} sample>
      <DetailHero icon={BarChart3} kind="Metric" title={metric.name} />
      <Card title="What this measures">
        <p className="text-base">{metric.measures}</p>
      </Card>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard
          title="Events · last 30 days"
          value={formatCount(metric.events30d)}
          line="times it happened"
        />
        <InfoCard
          title="Source"
          value={metric.integration}
          line="Where the events come from"
        />
        <InfoCard
          title="Category"
          value={metric.category}
          line="Type of integration"
        />
        <InfoCard
          title="Tracking since"
          value={formatBrandDate(metric.created, timezone) ?? '—'}
          line="First event date"
        />
      </div>
      <AdvancedDetails
        objectId={metric.id}
        attributes={{
          name: metric.name,
          integration: metric.integration,
          category: metric.category,
          created: metric.created
        }}
        linked={[
          {
            label: 'Flow triggers',
            items: data.snapshot.flows
              .filter(
                (f) =>
                  f.trigger.kind === 'metric' && f.trigger.name === metric.name
              )
              .map((f) => f.name)
          }
        ]}
      />
    </KlaviyoDetail>
  )
}
