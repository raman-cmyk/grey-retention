import Link from 'next/link'
import { rewriteAvailability } from '@/features/email-generation/config'
import { Composer } from '@/features/composer/composer'
import { randomUUID } from 'node:crypto'
import { EmptyState } from '@/components/ui/empty-state'
import type { Route } from 'next'
import { ArrowRight, Check, Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel, Notice } from '@/components/ui/workspace'
import { StatusMark } from '@/components/ui/status-mark'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import {
  campaignNextStep,
  campaignReview,
  overviewModel,
  type OverviewCampaign
} from './overview-model'
import type { campaignWorkspace } from './data'

type Workspace = Awaited<ReturnType<typeof campaignWorkspace>>

export function CampaignStages({ campaign }: { campaign: OverviewCampaign }) {
  const stages = [
    ['Calendar', campaign.calendar_state === 'approved'],
    ['Copy', campaign.copy_state === 'approved'],
    ['Design', campaign.design_state === 'owner_approved'],
    ['Delivery', ['scheduled', 'sent'].includes(campaign.delivery_state)]
  ] as const
  return (
    <ol
      aria-label="Campaign progress"
      className="flex flex-wrap gap-x-3 gap-y-1.5"
    >
      {stages.map(([label, approved]) => (
        <li
          key={label}
          className="flex items-center gap-1 text-[0.6875rem] text-[var(--text-muted)]"
        >
          {approved ? (
            <Check
              className="size-3 text-[var(--brand-secondary)]"
              aria-hidden
            />
          ) : (
            <span
              className="size-1.5 rounded-full border border-[var(--line-strong)]"
              aria-hidden
            />
          )}
          <span>
            {label}
            <span className="sr-only">
              {approved ? ' complete' : ' pending'}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * "Your campaigns": this workspace's campaigns, reviews and composer. It sits
 * under the old-app dashboard until the Campaigns list view (UIR-017) takes
 * the list over.
 */
export function CampaignOverview({
  workspace,
  focus,
  page
}: {
  workspace: Workspace
  focus?: string
  page?: string
}) {
  const { context, data, error } = workspace
  if (!data || error)
    return (
      <section aria-labelledby="your-campaigns" className="mt-10">
        <h2
          id="your-campaigns"
          className="tracking-display mb-4 font-serif text-2xl font-normal"
        >
          Your campaigns
        </h2>
        <Notice error>
          {error ?? 'Workspace unavailable. Refresh to retry.'}
        </Notice>
      </section>
    )
  const model = overviewModel(data.campaigns)
  const selection =
    focus === 'review'
      ? model.reviews
      : focus === 'scheduled'
        ? model.scheduled
        : model.current
  const brandApproved = Boolean(
    data.brand && data.brand.approved_revision === data.brand.revision
  )
  const pageCount = Math.max(1, Math.ceil(selection.length / 10))
  const requestedPage =
    typeof page === 'string' && /^\d{1,6}$/.test(page) ? Number(page) : 1
  const currentPage = Math.max(1, Math.min(requestedPage, pageCount))
  const shown = selection.slice((currentPage - 1) * 10, currentPage * 10)
  const pageLink = (number: number) =>
    `/dashboard?${new URLSearchParams({ ...(focus === 'review' || focus === 'scheduled' ? { focus } : {}), p: String(number) })}` as Route
  const date = new Intl.DateTimeFormat('en', {
    timeZone: context.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).format(new Date())
  const owner = context.tenantRole === 'owner'
  return (
    <section aria-labelledby="your-campaigns" className="mt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2
            id="your-campaigns"
            className="tracking-display font-serif text-2xl font-normal"
          >
            Your campaigns
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {date} · {context.tenantName}. Keep the next campaign moving.
          </p>
        </div>
        <Button asChild variant="outline" shape="pill">
          <Link href="/first-draft">
            <Plus className="size-4" aria-hidden />
            Create campaign
          </Link>
        </Button>
      </div>
      {owner && (
        <section aria-labelledby="composer-title" className="mb-8">
          <h2
            id="composer-title"
            className="tracking-label mb-3 font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase"
          >
            Make your version of an email
          </h2>
          <Composer
            requestKey={randomUUID()}
            brandName={data.brand?.brand_name ?? null}
            productCount={data.products.length}
            rewriteReady={rewriteAvailability(context.tenantId).ready}
          />
        </section>
      )}
      {data.campaigns.length === 0 && (
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-5">
          <div>
            <h2 className="text-sm font-semibold">
              New here? Start with one email.
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Add your brand, find a reference and plan your first draft.
            </p>
          </div>
          <Button asChild variant="secondary">
            <Link href="/get-started">
              Get started <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      )}
      <StatGrid label="Campaign progress" className="mb-7" columns={3}>
        <StatTile
          label="Awaiting review"
          value={model.reviews.length}
          caption={
            owner ? 'Your next decisions' : 'Waiting for the brand owner'
          }
          href={'/dashboard?focus=review' as Route}
        />
        <StatTile
          label="In production"
          value={model.inProduction.length}
          caption="Copy, design and preparation"
          href={'/campaign-agent' as Route}
        />
        <StatTile
          label="Scheduled"
          value={model.scheduled.length}
          caption="Sample sends only — no real email goes out yet"
          href={'/dashboard?focus=scheduled' as Route}
        />
      </StatGrid>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <Panel
          title="Campaign workspace"
          description="One place for each brief, review and delivery."
          action={
            <Link
              href="/campaign-agent"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--brand-secondary)]"
            >
              Open calendar
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }
        >
          <nav
            aria-label="Campaign filters"
            className="mb-2 flex flex-wrap gap-1 border-b border-[var(--line)] pb-3"
          >
            {[
              {
                label: 'All campaigns',
                href: '/dashboard',
                active: !['review', 'scheduled'].includes(focus ?? '')
              },
              {
                label: 'Needs review',
                href: '/dashboard?focus=review',
                active: focus === 'review'
              },
              {
                label: 'Scheduled',
                href: '/dashboard?focus=scheduled',
                active: focus === 'scheduled'
              }
            ].map((tab) => (
              <Link
                key={tab.href}
                href={tab.href as Route}
                aria-current={tab.active ? 'page' : undefined}
                className="rounded-md px-3 py-2 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)] aria-[current=page]:bg-[var(--surface-hover)] aria-[current=page]:text-[var(--text)]"
              >
                {tab.label}
              </Link>
            ))}
          </nav>
          {!selection.length ? (
            <EmptyState
              title={
                focus === 'review'
                  ? owner
                    ? 'Your review queue is clear.'
                    : 'Nothing is waiting for the brand owner.'
                  : focus === 'scheduled'
                    ? 'No campaigns scheduled yet.'
                    : 'Start your first campaign.'
              }
              description={
                focus === 'review'
                  ? owner
                    ? 'Campaigns appear here when a calendar, copy or design version needs your decision.'
                    : 'Campaigns appear here when a calendar, copy or design version needs the brand owner’s decision.'
                  : 'Plan a campaign, review its copy and design, then prepare delivery.'
              }
              action={
                <Button asChild variant="secondary">
                  <Link href="/campaign-agent">Open calendar</Link>
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-[var(--line)]">
              {shown.map((c) => {
                const planned = new Date(c.planned_at),
                  review = campaignReview(c),
                  next = campaignNextStep(c)
                return (
                  <Link
                    key={c.id}
                    href={`/campaigns/${c.id}` as Route}
                    className="group -mx-2 grid gap-3 rounded-lg px-2 py-4 hover:bg-[var(--surface-hover)] sm:grid-cols-[3.25rem_minmax(0,1fr)_auto] sm:items-center"
                  >
                    <time
                      dateTime={c.planned_at}
                      className="flex items-baseline gap-2 text-xs text-[var(--text-faint)] sm:block sm:text-center"
                    >
                      <span className="sm:block">
                        {new Intl.DateTimeFormat('en', {
                          timeZone: c.timezone,
                          month: 'short'
                        }).format(planned)}
                      </span>
                      <span className="text-lg font-semibold text-[var(--text)] tabular-nums sm:mt-0.5 sm:block">
                        {new Intl.DateTimeFormat('en', {
                          timeZone: c.timezone,
                          day: 'numeric'
                        }).format(planned)}
                      </span>
                    </time>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold break-words group-hover:text-[var(--brand-secondary)]">
                        {c.title}
                      </h3>
                      <p className="mt-1 mb-2 text-xs text-[var(--text-faint)]">
                        {c.channel === 'email_design'
                          ? 'Design email'
                          : 'Text email'}
                        {c.synthetic ? ' · Synthetic demo' : ''}
                      </p>
                      <CampaignStages campaign={c} />
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <StatusMark
                        tone={
                          ['failed', 'blocked', 'reconciling'].includes(
                            c.delivery_state
                          )
                            ? 'danger'
                            : review
                              ? 'warning'
                              : c.delivery_state === 'scheduled'
                                ? 'active'
                                : 'neutral'
                        }
                      >
                        {next}
                      </StatusMark>
                      <ArrowRight
                        className="size-4 text-[var(--text-faint)]"
                        aria-hidden
                      />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
          {selection.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
              <p className="text-xs text-[var(--text-faint)]">
                Showing {(currentPage - 1) * 10 + 1}–
                {Math.min(currentPage * 10, selection.length)} of{' '}
                {selection.length} campaigns
              </p>
              <nav aria-label="Campaign pages" className="flex gap-2">
                {currentPage > 1 && (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={pageLink(currentPage - 1)}>Previous</Link>
                  </Button>
                )}
                {currentPage < pageCount && (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={pageLink(currentPage + 1)}>Next</Link>
                  </Button>
                )}
              </nav>
            </div>
          )}
        </Panel>
        <div className="space-y-6">
          <Panel title={owner ? 'Your review queue' : 'Owner review queue'}>
            <p className="mb-4 text-sm leading-6 text-[var(--text-muted)]">
              {model.reviews.length
                ? `${model.reviews.length} campaign${model.reviews.length === 1 ? '' : 's'} awaiting an exact version decision.`
                : 'All current reviews are complete. New versions will appear here.'}
            </p>
            {model.reviews.slice(0, 4).map((c) => (
              <Link
                href={`/campaigns/${c.id}` as Route}
                key={c.id}
                className="mb-3 block rounded-lg bg-[var(--surface-hover)] p-3"
              >
                <p className="text-xs font-medium text-[var(--brand-ink)]">
                  {campaignReview(c)}
                </p>
                <p className="mt-1 text-sm font-medium break-words">
                  {c.title}
                </p>
              </Link>
            ))}
            <Link
              href="/copy-review"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-secondary)]"
            >
              Open weekly copy review
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Panel>
          <Panel title="Brand foundation">
            <div className="space-y-4">
              {[
                {
                  label: 'Brand facts',
                  detail: brandApproved
                    ? 'Current version approved'
                    : 'Review and approve your profile',
                  href: '/brand',
                  ready: brandApproved
                },
                {
                  label: 'Product catalog',
                  detail: `${data.products.length} product${data.products.length === 1 ? '' : 's'} in your workspace`,
                  href: '/brand',
                  ready: data.products.length > 0
                },
                {
                  label: 'Permitted offers',
                  detail: `${data.offers.length} saved offer${data.offers.length === 1 ? '' : 's'}`,
                  href: '/brand',
                  ready: data.offers.length > 0
                }
              ].map((item) => (
                <Link
                  key={item.label}
                  href={item.href as Route}
                  className="flex items-start gap-2.5"
                >
                  {item.ready ? (
                    <Check
                      className="mt-0.5 size-4 text-[var(--brand-secondary)]"
                      aria-hidden
                    />
                  ) : (
                    <span
                      className="mt-1 size-3 rounded-full border border-[var(--line-strong)]"
                      aria-hidden
                    />
                  )}
                  <div>
                    <p className="text-xs font-semibold">{item.label}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                      {item.detail}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
            <Link
              href="/connections"
              className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-secondary)]"
            >
              Check setup readiness
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Panel>
          <Link
            href="/gros"
            className="flex items-start gap-3 rounded-xl border border-[var(--line)] p-4 hover:bg-[var(--surface-raised)]"
          >
            <Sparkles
              className="mt-0.5 size-4 text-[var(--brand-secondary)]"
              aria-hidden
            />
            <div>
              <p className="text-sm font-semibold">
                Think it through with GROS
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                Ask about your next campaign. Review proposals before applying
                changes.
              </p>
            </div>
          </Link>
          <p className="px-1 text-xs leading-5 text-[var(--text-faint)]">
            {process.env.AUTH_MODE === 'demo'
              ? 'Synthetic workspace. Delivery and results use fixtures; live providers remain disabled.'
              : 'Sending and performance data use samples. Emails you add and create are saved.'}
          </p>
        </div>
      </div>
    </section>
  )
}
