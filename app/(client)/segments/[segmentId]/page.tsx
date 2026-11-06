import { Filter } from 'lucide-react'
import { notFound } from 'next/navigation'
import {
  Card,
  AdvancedDetails,
  DetailHero,
  TimelineCard
} from '@/components/ui/detail-page'
import { Pill } from '@/components/ui/pill'
import { formatCount } from '@/features/klaviyo-data/summary'
import {
  InfoCard,
  KlaviyoDetail,
  loadKlaviyo,
  NotConnected
} from '@/features/klaviyo-detail/parts'

export default async function SegmentPage({
  params,
  searchParams
}: {
  params: Promise<{ segmentId: string }>
  searchParams: Promise<{ from?: string | string[] }>
}) {
  const [{ segmentId }, { from }, { timezone, data }] = await Promise.all([
    params,
    searchParams,
    loadKlaviyo()
  ])
  if (data.state !== 'sample') return <NotConnected from={from} data={data} />
  const segment = data.snapshot.segments.find((s) => s.id === segmentId)
  if (!segment) notFound()
  return (
    <KlaviyoDetail from={from} sample>
      <DetailHero
        icon={Filter}
        kind="Segment"
        title={segment.name}
        status={
          <span className="flex flex-wrap gap-2">
            {segment.active ? (
              <Pill tone="success">Active</Pill>
            ) : (
              <Pill>Inactive</Pill>
            )}
            {segment.starred && <Pill tone="warning">★ Starred</Pill>}
          </span>
        }
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <InfoCard
          title="Profiles in segment"
          value={formatCount(segment.profileCount)}
          line="people match"
        />
        <InfoCard title="What this is">
          <p className="mt-2 text-sm leading-6">
            A <strong>segment</strong> is a dynamic group: profiles enter and
            exit automatically based on rules you set up in Klaviyo. Unlike
            lists (which are static and need a sign-up), segments recalculate as
            your data changes.
          </p>
        </InfoCard>
      </div>
      <Card title="How this segment is defined">
        <p className="text-sm text-[var(--text-muted)]">
          The rules below decide who is in this segment.
        </p>
        <p className="mt-3 text-base">{segment.rules}</p>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          The exact rules as Klaviyo stores them are in Advanced details.
        </p>
      </Card>
      <TimelineCard
        created={segment.created}
        updated={segment.updated}
        timezone={timezone}
      />
      <AdvancedDetails
        objectId={segment.id}
        attributes={{
          name: segment.name,
          is_active: segment.active,
          is_starred: segment.starred,
          profile_count: segment.profileCount,
          definition: segment.definition,
          created: segment.created,
          updated: segment.updated
        }}
        linked={[
          { label: 'Profiles', items: [] },
          { label: 'Tags', items: [] },
          {
            label: 'Campaigns',
            items: data.snapshot.campaigns
              .filter((c) =>
                [...c.included, ...c.excluded].some((a) => a.id === segment.id)
              )
              .map((c) => c.name)
          }
        ]}
      />
    </KlaviyoDetail>
  )
}
