import type { Route } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
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
        counts={view.counts}
        now={view.now}
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
          {owner && (
            <Link
              href="/copy-review"
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-5 py-4 transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden"
            >
              <div>
                <span className="text-sm font-semibold">
                  Weekly copy review
                </span>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                  Review approved calendar entries and confirm the exact copy
                  batch.
                </p>
              </div>
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--brand-ink)]">
                Open weekly copy review
                <ArrowRight className="size-4" aria-hidden="true" />
              </span>
            </Link>
          )}
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
