import Link from 'next/link'
import type { Route } from 'next'
import { PageHeading, Panel, Notice } from '@/components/ui/workspace'
import { Button } from '@/components/ui/button'
import { StatusMark } from '@/components/ui/status-mark'
import { campaignWorkspace } from '@/features/campaigns/data'
export default async function DashboardPage() {
  const { context, data, error } = await campaignWorkspace()
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Campaign proof table"
        description={`${context.tenantName} · ${context.timezone}. Review calendar, copy, design and delivery versions in one persisted workspace.`}
        action={
          <Button asChild>
            <Link href="/campaign-agent">Create campaign</Link>
          </Button>
        }
      />
      {error ? (
        <Notice error>{error}</Notice>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel title="Active proofs">
            {data!.campaigns.length === 0 ? (
              <Notice>Create your first calendar entry to begin.</Notice>
            ) : (
              <div className="divide-y divide-[var(--line)]">
                {data!.campaigns.map((c) => (
                  <Link
                    className="grid gap-3 py-5 hover:bg-[var(--surface-hover)] sm:grid-cols-[6rem_1fr]"
                    key={c.id}
                    href={`/campaigns/${c.id}` as Route}
                  >
                    <time className="text-xs text-[var(--text-muted)]">
                      {new Intl.DateTimeFormat('en', {
                        timeZone: c.timezone,
                        month: 'short',
                        day: 'numeric'
                      }).format(new Date(c.planned_at))}
                    </time>
                    <div>
                      <h3 className="font-semibold">{c.title}</h3>
                      <p className="my-2 text-sm text-[var(--text-muted)]">
                        {c.synthetic ? 'Synthetic demo · ' : ''}Calendar v
                        {c.calendar_revision} · Copy v{c.copy_revision} · Design
                        v{c.design_revision}
                      </p>
                      <StatusMark tone="neutral">
                        {c.delivery_state !== 'not_ready'
                          ? c.delivery_state
                          : c.copy_state === 'draft'
                            ? c.calendar_state
                            : c.copy_state.replaceAll('_', ' ')}
                      </StatusMark>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Review rail">
            <p className="text-sm leading-6">
              Approve calendar entries before copy. Designs return to the brand
              owner for section feedback and final version approval.
            </p>
            <dl className="my-5 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt>Entries</dt>
                <dd>{data!.campaigns.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Owner reviews</dt>
                <dd>
                  {
                    data!.campaigns.filter(
                      (c) =>
                        c.calendar_state === 'proposed' ||
                        c.copy_state === 'pending_approval' ||
                        c.design_state === 'submitted'
                    ).length
                  }
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Provider mode</dt>
                <dd>Fixture only</dd>
              </div>
            </dl>
            <Button asChild variant="secondary">
              <Link href="/campaign-agent">Open calendar</Link>
            </Button>
            <p className="mt-5 text-xs leading-5 text-[var(--text-muted)]">
              External results appear after confirmed simulated sends. No
              measured revenue is claimed from fixture data.
            </p>
          </Panel>
        </div>
      )}
    </div>
  )
}
