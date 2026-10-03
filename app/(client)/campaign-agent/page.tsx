import Link from 'next/link'
import type { Route } from 'next'
import { PageHeading, Panel, Notice } from '@/components/ui/workspace'
import { StatusMark } from '@/components/ui/status-mark'
import { campaignWorkspace } from '@/features/campaigns/data'
import { CampaignEditor } from '@/features/campaigns/editor'
import { PlanningPanel } from '@/features/planning/panels'
export default async function CampaignAgentPage({
  searchParams
}: {
  searchParams: Promise<{ m?: string; view?: string }>
}) {
  const { context, data, error } = await campaignWorkspace()
  const params = await searchParams
  const month = /^\d{4}-\d{2}$/.test(params.m ?? '')
    ? params.m!
    : new Intl.DateTimeFormat('en-CA', {
        timeZone: context.timezone,
        year: 'numeric',
        month: '2-digit'
      }).format(new Date())
  const campaigns =
    data?.campaigns.filter(
      (c) =>
        (params.view === 'history' || !c.superseded_by_plan) &&
        new Date(c.planned_at)
          .toLocaleDateString('en-CA', { timeZone: c.timezone })
          .startsWith(month)
    ) ?? []
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Campaign calendar"
        description={`Plan and review exact campaign versions. Times shown in ${context.timezone}. Fixture audiences never send to real recipients.`}
      />
      {error ? (
        <Notice error>{error}</Notice>
      ) : (
        <>
          <form className="mb-5 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Month
              <input
                name="m"
                type="month"
                defaultValue={month}
                className="ml-2 rounded-lg border border-[var(--line-strong)] bg-white p-2"
              />
            </label>
            <label className="text-sm">
              View
              <select
                name="view"
                defaultValue={params.view ?? 'calendar'}
                className="ml-2 rounded-lg border border-[var(--line-strong)] bg-white p-2"
              >
                <option value="calendar">Calendar</option>
                <option value="list">List</option>
                <option value="history">History including superseded</option>
              </select>
            </label>
            <button className="min-h-10 rounded-lg bg-[var(--brand-primary)] px-4 text-sm text-[var(--on-brand)]">
              Show month
            </button>
          </form>
          <Panel title={`${month} · ${campaigns.length} entries`}>
            {campaigns.length === 0 ? (
              <Notice>
                No entries for this month. Create a campaign below.
              </Notice>
            ) : (
              <div
                className={
                  params.view === 'list'
                    ? 'divide-y divide-[var(--line)]'
                    : 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
                }
              >
                {campaigns.map((c) => (
                  <Link
                    key={c.id}
                    href={`/campaigns/${c.id}` as Route}
                    className="block rounded-lg border border-[var(--line)] p-4 transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                  >
                    <time
                      className="text-xs text-[var(--text-muted)]"
                      dateTime={c.planned_at}
                    >
                      {new Intl.DateTimeFormat('en', {
                        timeZone: c.timezone,
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                      }).format(new Date(c.planned_at))}
                    </time>
                    <h3 className="mt-2 font-semibold">{c.title}</h3>
                    <p className="my-2 text-xs text-[var(--text-muted)]">
                      {c.channel === 'email_design'
                        ? 'Design email'
                        : 'Text email'}{' '}
                      · revision {c.calendar_revision}
                      {c.synthetic ? ' · Synthetic demo' : ''}
                    </p>
                    <StatusMark
                      tone={
                        c.calendar_state === 'approved' ? 'active' : 'neutral'
                      }
                    >
                      {c.calendar_state}
                    </StatusMark>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
          <div className="mt-5">
            <Link
              href="/copy-review"
              className="text-sm font-semibold underline"
            >
              Open weekly copy review
            </Link>
          </div>
          <PlanningPanel
            tenantId={context.tenantId}
            owner={context.tenantRole === 'owner'}
            campaigns={data!.campaigns}
            audiences={data!.audiences}
          />
          <Panel title="Create a campaign" className="mt-6">
            <CampaignEditor
              products={data!.products}
              offers={data!.offers}
              audiences={data!.audiences}
            />
          </Panel>
        </>
      )}
    </div>
  )
}
