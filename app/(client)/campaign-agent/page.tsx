import Link from 'next/link'
import { ArrowRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeading, Panel, Notice } from '@/components/ui/workspace'
import { campaignWorkspace } from '@/features/campaigns/data'
import { CampaignEditor } from '@/features/campaigns/editor'
import { CampaignCalendar } from '@/features/campaigns/calendar'
import {
  calendarMonth,
  calendarView
} from '@/features/campaigns/calendar-model'
import { PlanningPanel } from '@/features/planning/panels'
export default async function CampaignAgentPage({
  searchParams
}: {
  searchParams: Promise<{ m?: string | string[]; view?: string | string[] }>
}) {
  const { context, data, error } = await campaignWorkspace()
  const params = await searchParams
  const month = calendarMonth(params.m, context.timezone)
  const view = calendarView(params.view)
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Campaigns"
        description="Shape the month, review each campaign, and keep every approval tied to the right version."
        action={
          data && (
            <Button asChild variant="outline" shape="pill">
              <a href="#create-campaign">
                <Plus className="size-4" aria-hidden="true" />
                New campaign
              </a>
            </Button>
          )
        }
      />
      {error ? (
        <Notice error>{error}</Notice>
      ) : (
        <>
          <CampaignCalendar
            campaigns={data!.campaigns}
            month={month}
            view={view}
            timezone={context.timezone}
          />
          {context.tenantRole === 'owner' && (
            <Link
              href="/copy-review"
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-5 py-4 transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
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
          <PlanningPanel
            tenantId={context.tenantId}
            owner={context.tenantRole === 'owner'}
            campaigns={data!.campaigns}
            audiences={data!.audiences}
          />
          <div id="create-campaign" className="mt-6 scroll-mt-28">
            <Panel title="Create a campaign">
              <CampaignEditor
                products={data!.products}
                offers={data!.offers}
                audiences={data!.audiences}
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
