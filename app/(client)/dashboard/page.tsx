import { campaignWorkspace } from '@/features/campaigns/data'
import { CampaignOverview } from '@/features/campaigns/overview'
import {
  campaignReview,
  overviewModel
} from '@/features/campaigns/overview-model'
import {
  dashboardKpis,
  gauge,
  numbersInsight,
  upcomingSends
} from '@/features/dashboard/model'
import {
  ApprovalsCard,
  CalendarMiniCard,
  DashboardHeader,
  InsightCard,
  KpiStrip,
  NextCampaignCard,
  RevenueCard
} from '@/features/dashboard/sections'
import { KlaviyoDataCard, parseTab } from '@/features/dashboard/klaviyo-card'
import { klaviyoData } from '@/features/klaviyo-data/reader'
import { Notice } from '@/components/ui/workspace'

type Params = {
  focus?: string
  p?: string
  attr?: string | string[]
  insight?: string | string[]
  tab?: string | string[]
}

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/**
 * Dashboard (docs/UI_REBUILD_SPEC.md §3, behaviour from
 * docs/OWNER_JOURNEYS.md §3): Klaviyo numbers on top, this workspace's own
 * campaigns underneath.
 */
export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<Params>
}) {
  const [workspace, params] = await Promise.all([
    campaignWorkspace(),
    searchParams
  ])
  const now = new Date()
  const timezone = workspace.context.timezone
  const klaviyo = await klaviyoData(timezone, now)
  const snapshot = klaviyo.state === 'sample' ? klaviyo.snapshot : null
  const campaigns = workspace.data?.campaigns ?? []
  const attribution = one(params.attr) === 'utm' ? 'utm' : 'klaviyo'
  const sends = upcomingSends(campaigns, snapshot, now)
  const waiting = overviewModel(campaigns).reviews.map((c) => ({
    id: c.id,
    title: c.title,
    step: campaignReview(c) ?? 'Review'
  }))
  const revenue = snapshot ? gauge(snapshot, now, null) : null
  return (
    <div className="mx-auto max-w-6xl">
      <DashboardHeader
        syncedAt={snapshot?.syncedAt ?? null}
        sample={klaviyo.state === 'sample'}
        now={now}
      />
      {snapshot ? (
        <KpiStrip kpis={dashboardKpis(snapshot)} />
      ) : (
        <Notice>
          Klaviyo is not connected, so there are no Klaviyo numbers yet.
        </Notice>
      )}
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        {revenue ? (
          <RevenueCard
            attribution={attribution}
            value={revenue.label}
            goal={revenue.goal}
            fraction={revenue.fraction}
            shopifyConnected={false}
          />
        ) : null}
        <NextCampaignCard
          next={sends[0] ?? null}
          timezone={timezone}
          now={now}
        />
        <CalendarMiniCard sends={sends} timezone={timezone} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <ApprovalsCard
          waiting={waiting}
          owner={workspace.context.tenantRole === 'owner'}
        />
        {snapshot && (
          <InsightCard
            insight={numbersInsight(snapshot)}
            shown={one(params.insight) === '1'}
          />
        )}
      </div>
      {snapshot && (
        <KlaviyoDataCard
          snapshot={snapshot}
          tab={parseTab(params.tab)}
          credits={{
            // AI usage is not metered per workspace yet: sample numbers.
            plan: 'Sample plan',
            renewsInDays: 30,
            used: 2500,
            included: 10000,
            sample: true
          }}
        />
      )}
      <CampaignOverview
        workspace={workspace}
        focus={params.focus}
        page={params.p}
      />
    </div>
  )
}
