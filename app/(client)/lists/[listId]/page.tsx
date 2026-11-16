import { List } from 'lucide-react'
import { notFound } from 'next/navigation'
import {
  AdvancedDetails,
  DetailHero,
  TimelineCard
} from '@/components/ui/detail-page'
import { formatCount } from '@/features/klaviyo-data/summary'
import {
  InfoCard,
  KlaviyoDetail,
  loadKlaviyo,
  NotConnected
} from '@/features/klaviyo-detail/parts'
import { backToAudiences } from '@/features/klaviyo-detail/source'
import { optInWords } from '@/features/klaviyo-detail/words'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'List' }

export default async function ListPage({
  params
}: {
  params: Promise<{ listId: string }>
}) {
  const [{ listId }, { timezone, data }] = await Promise.all([
    params,
    loadKlaviyo()
  ])
  if (data.state !== 'sample')
    return <NotConnected back={backToAudiences} data={data} />
  const list = data.snapshot.lists.find((l) => l.id === listId)
  if (!list) notFound()
  const optIn = optInWords(list.optIn)
  return (
    <KlaviyoDetail back={backToAudiences}>
      <DetailHero icon={List} kind="List" title={list.name} />
      <div className="grid gap-5 sm:grid-cols-2">
        <InfoCard
          title="Subscribers"
          value={formatCount(list.profileCount)}
          line="people on this list"
        />
        <InfoCard
          title="Sign-up method"
          value={optIn.label}
          line={optIn.line}
        />
      </div>
      <TimelineCard
        created={list.created}
        updated={list.updated}
        timezone={timezone}
      />
      <AdvancedDetails
        objectId={list.id}
        attributes={{
          name: list.name,
          created: list.created,
          updated: list.updated,
          opt_in_process:
            list.optIn === 'double' ? 'double_opt_in' : 'single_opt_in',
          profile_count: list.profileCount
        }}
        linked={[
          {
            label: 'Flow triggers',
            items: data.snapshot.flows
              .filter(
                (f) => f.trigger.kind === 'list' && f.trigger.name === list.name
              )
              .map((f) => f.name)
          }
        ]}
      />
    </KlaviyoDetail>
  )
}
