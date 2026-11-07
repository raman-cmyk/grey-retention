import Link from 'next/link'
import { rewriteAvailability } from '@/features/email-generation/config'
import { Composer } from '@/features/composer/composer'
import { randomUUID } from 'node:crypto'
import { EmptyState } from '@/components/ui/empty-state'
import type { Route } from 'next'
import { ArrowRight, Check, Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel, Notice } from '@/components/ui/workspace'
import { CampaignPill } from './status-pill'
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

function defaultLink(patch: { focus?: string | null; p?: string | null }) {
  const params = new URLSearchParams()
  if (patch.focus) params.set('focus', patch.focus)
  if (patch.p) params.set('p', patch.p)
  const query = params.toString()
  return `/dashboard${query ? `?${query}` : ''}#your-campaigns` as Route
}

/**
 * "Your campaigns": this workspace's campaigns, reviews and composer. It sits
 * under the old-app dashboard until the Campaigns list view (UIR-017) takes
 * the list over.
 */
export function CampaignOverview({
  workspace,
  focus,
  page,
  linkTo = defaultLink
}: {
  workspace: Workspace
  focus?: string
  page?: string
  /** Builds a dashboard link that keeps the rest of the page's state. */
  linkTo?: (patch: { focus?: string | null; p?: string | null }) => Route
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
  // One clock for the whole list, so a pill and its queue always agree.
  const now = new Date()
  const model = overviewModel(data.campaigns, now)
  const selection =
    focus === 'review'
      ? model.reviews
      : focus === 'scheduled'
        ? model.scheduled
        : focus === 'attention'
          ? model.attention
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
    linkTo({
      focus:
        focus === 'review' || focus === 'scheduled' || focus === 'attention'
          ? focus
          : null,
      p: String(number)
    })
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
          <h3
            id="composer-title"
            className="tracking-label mb-3 font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase"
          >
            Make your version of an email
          </h3>
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
            <h3 className="text-sm font-semibold">
              New here? Start with one email.
            </h3>
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
      <StatGrid label="Campaign progress" className="mb-7" columns={4}>
        <StatTile
          label="Needs your approval"
          value={model.reviews.length}
          caption={
            owner ? 'Your next decisions' : 'Waiting for the brand owner'
          }
          href={linkTo({ focus: 'review', p: null })}
        />
        <StatTile
          label="In progress"
          value={model.inProduction.length}
          caption="Drafts and designs being made"
          href={'/campaign-agent' as Route}
        />
        <StatTile
          label="Scheduled"
          value={model.scheduled.length}
          caption="Sample sends only — no real email goes out yet"
          href={linkTo({ focus: 'scheduled', p: null })}
        />
        <StatTile
          label="Needs a look"
          value={model.attention.length}
          caption="Missed, or a delivery problem"
          href={linkTo({ focus: 'attention', p: null })}
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
                href: linkTo({ focus: null, p: null }),
                active: !['review', 'scheduled', 'attention'].includes(
                  focus ?? ''
                )
              },
              {
                label: 'Needs your approval',
                href: linkTo({ focus: 'review', p: null }),
                active: focus === 'review'
              },
              {
                label: 'Scheduled',
                href: linkTo({ focus: 'scheduled', p: null }),
                active: focus === 'scheduled'
              },
              {
                label: 'Needs a look',
                href: linkTo({ focus: 'attention', p: null }),
                active: focus === 'attention'
              }
            ].map((tab) => (
              <Link
                key={tab.label}
                href={tab.href}
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
                    : focus === 'attention'
                      ? 'Nothing needs a look.'
                      : 'Start your first campaign.'
              }
              description={
                focus === 'review'
                  ? owner
                    ? 'Campaigns appear here when a date, copy or design needs your decision, or one is ready to approve and schedule.'
                    : 'Campaigns appear here when a date, copy or design needs the brand owner’s decision, or one is ready to approve and schedule.'
                  : focus === 'attention'
                    ? 'Campaigns appear here when their time passed before they were scheduled, or when sending failed or could not be confirmed.'
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
                  next = campaignNextStep(c, now)
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
                      <span className="flex flex-col items-end gap-1 text-right">
                        <CampaignPill campaign={c} now={now} />
                        {next && (
                          <span className="text-xs text-[var(--text-muted)]">
                            Next: {next}
                          </span>
                        )}
                      </span>
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
                ? `${model.reviews.length} campaign${model.reviews.length === 1 ? '' : 's'} waiting for ${owner ? 'your' : 'the owner’s'} approval.`
                : 'All current reviews are complete. New versions will appear here.'}
            </p>
            {model.reviews.slice(0, 4).map((c) => (
              <Link
                href={`/campaigns/${c.id}` as Route}
                key={c.id}
                className="mb-3 block rounded-lg bg-[var(--surface-hover)] p-3"
              >
                <p className="text-xs font-medium text-[var(--brand-ink)]">
                  {campaignReview(c, now)}
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
