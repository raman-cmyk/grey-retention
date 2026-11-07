import { CampaignOverview } from '@/features/campaigns/overview'
import { KlaviyoDataCard } from '@/features/dashboard/klaviyo-card'
import { dashboardView } from '@/features/dashboard/load'
import {
  ApprovalsCard,
  CalendarMiniCard,
  DashboardHeader,
  InsightCard,
  KpiStrip,
  NextCampaignCard,
  RevenueCard
} from '@/features/dashboard/sections'

/**
 * Dashboard (docs/UI_REBUILD_SPEC.md §3, behaviour from
 * docs/OWNER_JOURNEYS.md §3): Klaviyo numbers on top, this workspace's own
 * campaigns underneath.
 */
export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const view = await dashboardView(await searchParams)
  return (
    <div className="mx-auto max-w-6xl">
      <DashboardHeader data={view.klaviyo} now={view.now} />
      {view.kpis && <KpiStrip kpis={view.kpis} />}
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        {view.revenue && (
          <RevenueCard
            attribution={view.attribution}
            hrefs={view.attributionHrefs}
            value={view.revenue.label}
            utmValue={null}
            goal={view.revenue.goal}
            fraction={view.revenue.fraction}
          />
        )}
        <NextCampaignCard
          next={view.sends[0] ?? null}
          timezone={view.timezone}
          now={view.now}
          owner={view.owner}
          campaignsFailed={view.campaignsFailed}
        />
        <CalendarMiniCard
          sends={view.sends}
          timezone={view.timezone}
          owner={view.owner}
          campaignsFailed={view.campaignsFailed}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <ApprovalsCard
          waiting={view.waiting}
          owner={view.owner}
          seeAll={view.seeAllWaiting}
          campaignsFailed={view.campaignsFailed}
        />
        {view.insight && (
          <InsightCard
            insight={view.insight}
            shown={view.insightShown}
            generate={view.insightHref}
          />
        )}
      </div>
      {view.snapshot && (
        <KlaviyoDataCard
          snapshot={view.snapshot}
          tab={view.tab}
          tabHrefs={view.tabHrefs}
          timezone={view.timezone}
          credits={view.credits}
          links={{
            lists: true,
            segments: true,
            campaigns: true,
            flows: true,
            metrics: true
          }}
        />
      )}
      <CampaignOverview
        workspace={view.workspace}
        focus={view.query.focus}
        page={view.query.p}
        linkTo={view.campaignLink}
      />
    </div>
  )
}
