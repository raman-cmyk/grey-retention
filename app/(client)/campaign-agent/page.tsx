import type { Route } from 'next'
import { PageHeading, Panel, Notice } from '@/components/ui/workspace'
import { BrandCheck } from '@/features/brand-profile/brand-check'
import { CampaignEditor } from '@/features/campaigns/editor'
import { plannerView } from '@/features/planner/load'
import { Planner } from '@/features/planner/planner'
import { PlanningPanel } from '@/features/planning/panels'

export default async function CampaignAgentPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const view = await plannerView(await searchParams)
  const { workspace, owner } = view
  const { context, data, error } = workspace
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        title="Campaigns"
        description="Plan the month, see every send in one place, and approve each campaign before it goes out."
      />
      {error && (
        <div className="mb-4">
          <Notice error>{error}</Notice>
        </div>
      )}
      {view.holidaysFailed && (
        <div className="mb-4">
          <Notice error>
            Holidays and events could not load, so the calendar shows none.
          </Notice>
        </div>
      )}
      <Planner
        query={view.query}
        month={view.month}
        unscheduled={view.unscheduled}
        timezone={view.timezone}
        klaviyoLine={view.klaviyoLine}
        canPlan={owner && !!data}
        campaignsFailed={view.campaignsFailed}
        klaviyoLabel={view.klaviyoLabel}
        summary={view.summary}
        newItems={[
          ...(data
            ? [
                {
                  label: 'Single send',
                  hint: 'One email, written and designed for one date.',
                  href: '#create-campaign' as Route
                }
              ]
            : []),
          // The monthly plan is the owner's (the server checks it too).
          ...(data && owner
            ? [
                {
                  // Becomes "Fill the month with AI" when the AI planner lands.
                  label: 'Fill the month (sample plan)',
                  hint: 'A sample plan for now: no AI yet. You review every send before anything is made.',
                  href: '#planning' as Route
                }
              ]
            : [])
        ]}
      />
      {data && (
        <>
          {/* UIR-021: before GROS plans the month or writes a campaign. */}
          <BrandCheck
            tenantId={context.tenantId}
            action="GROS plans or writes your campaigns"
          />
          <div id="planning" className="scroll-mt-28">
            <PlanningPanel
              tenantId={context.tenantId}
              owner={owner}
              campaigns={data.campaigns}
              audiences={data.audiences}
            />
          </div>
          <div id="create-campaign" className="mt-6 scroll-mt-28">
            <Panel title="Create a campaign">
              <CampaignEditor
                products={data.products}
                offers={data.offers}
                audiences={data.audiences}
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
