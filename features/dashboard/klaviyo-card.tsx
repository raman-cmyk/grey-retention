import {
  BarChart3,
  ChevronRight,
  Database,
  Filter,
  LayoutGrid,
  List,
  Mail,
  Star,
  Workflow,
  type LucideIcon
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CreditsIndicator } from '@/components/ui/credits-indicator'
import { Pill } from '@/components/ui/pill'
import type { PillTone } from '@/lib/campaign-status'
import {
  formatBrandDate,
  formatBrandDateTime,
  timezoneLabel
} from '@/lib/brand-time'
import { cn } from '@/lib/utils'
import {
  campaignsNewestFirst,
  formatCount,
  formatMoney,
  revenueSummary
} from '@/features/klaviyo-data/summary'
import type {
  KlaviyoCampaign,
  KlaviyoSnapshot
} from '@/lib/providers/klaviyo-read'

export const klaviyoTabs = [
  'overview',
  'lists',
  'segments',
  'campaigns',
  'flows',
  'metrics'
] as const
export type KlaviyoTab = (typeof klaviyoTabs)[number]

export function parseTab(value: unknown): KlaviyoTab {
  const tab = Array.isArray(value) ? value[0] : value
  return (klaviyoTabs as readonly unknown[]).includes(tab)
    ? (tab as KlaviyoTab)
    : 'overview'
}

const label =
  'tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'

const tabMeta: Record<KlaviyoTab, { text: string; icon: LucideIcon }> = {
  overview: { text: 'Overview', icon: LayoutGrid },
  lists: { text: 'Lists', icon: List },
  segments: { text: 'Segments', icon: Filter },
  campaigns: { text: 'Campaigns', icon: Mail },
  flows: { text: 'Flows', icon: Workflow },
  metrics: { text: 'Metrics', icon: BarChart3 }
}

/** Which object kinds have detail pages (§4); rows link only to those. */
export type DetailLinks = Partial<
  Record<'lists' | 'segments' | 'campaigns' | 'flows' | 'metrics', boolean>
>

export type Credits = {
  plan: string
  renewsInDays: number | null
  used: number
  included: number
  sample: boolean
  format?: (value: number) => string
}

/** The 30-day revenue headline and bar chart (Overview tab only). */
export function RevenueChart({
  snapshot,
  timezone
}: {
  snapshot: KlaviyoSnapshot
  timezone: string
}) {
  const summary = revenueSummary(snapshot)
  const max = Math.max(1, ...snapshot.daily.map((d) => d.revenue.minor))
  const best = summary.bestDay
  const dayLabel = (date: string) =>
    formatBrandDate(`${date}T12:00:00Z`, 'UTC') ?? date
  const ticks = [
    0,
    Math.floor(snapshot.daily.length / 2),
    snapshot.daily.length - 1
  ]
  return (
    <section aria-label="Revenue in the last 30 days" className="mt-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={label}>Revenue · last 30 days</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums">
            {formatMoney(summary.total)}
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            attributed to Klaviyo emails & flows · {summary.activeDays} active
            days
          </p>
        </div>
        <dl className="flex gap-3">
          <div className="rounded-[var(--radius-control)] border border-[var(--line)] px-4 py-2">
            <dt className={label}>Avg / day</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              {formatMoney(summary.averagePerDay)}
            </dd>
          </div>
          <div className="rounded-[var(--radius-control)] border border-[var(--line)] px-4 py-2">
            <dt className={label}>Best day</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              {best ? formatMoney(best.revenue) : '—'}
              {best && (
                <span className="block text-xs font-normal text-[var(--text-muted)]">
                  {dayLabel(best.date)}
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>
      <div
        role="img"
        aria-label={`Daily revenue for the last 30 days (${timezoneLabel(timezone)}). Best day ${best ? `${dayLabel(best.date)}, ${formatMoney(best.revenue)}` : 'none'}. The table below lists every day.`}
        className="mt-5 flex h-32 items-end gap-[3px]"
      >
        {snapshot.daily.map((day, index) => {
          const isBest = best?.date === day.date
          // Keep the edge tooltips inside the card.
          const align =
            index < 4
              ? 'left-0'
              : index > snapshot.daily.length - 5
                ? 'right-0'
                : 'left-1/2 -translate-x-1/2'
          return (
            <div
              key={day.date}
              className="group relative flex h-full min-w-0 flex-1 items-end"
            >
              <span
                data-best={isBest || undefined}
                className="block w-full rounded-t-[3px] bg-[var(--line-strong)] group-hover:bg-[var(--text-muted)] data-[best]:bg-[var(--brand-secondary)] forced-colors:bg-[CanvasText] forced-colors:data-[best]:bg-[Highlight]"
                style={{
                  height: `${Math.max(2, Math.round((day.revenue.minor / max) * 100))}%`
                }}
              />
              {/* Hover tooltip (§15 bug 7: the old bars had none). */}
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute bottom-full z-10 mb-2 hidden rounded-sm bg-[var(--text)] px-2 py-1 text-xs whitespace-nowrap text-[var(--surface-raised)] group-hover:block',
                  align
                )}
              >
                {dayLabel(day.date)} · {formatMoney(day.revenue)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-[var(--text-muted)]">
        {ticks.map((index) => (
          <span key={index}>{dayLabel(snapshot.daily[index]?.date ?? '')}</span>
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-[var(--text-muted)]">
          Show daily revenue as a table
        </summary>
        <table className="mt-2 w-full max-w-sm text-left tabular-nums">
          <caption className="sr-only">Daily revenue, last 30 days</caption>
          <thead>
            <tr>
              <th scope="col" className={label}>
                Day
              </th>
              <th scope="col" className={cn(label, 'text-right')}>
                Revenue
              </th>
            </tr>
          </thead>
          <tbody>
            {snapshot.daily.map((day) => (
              <tr key={day.date}>
                <td className="py-0.5">{dayLabel(day.date)}</td>
                <td className="py-0.5 text-right">
                  {formatMoney(day.revenue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}

function Table({
  caption,
  headers,
  right = [],
  linked,
  children
}: {
  caption: string
  headers: string[]
  right?: number[]
  /** Rows link to detail pages, so an "Open" column is shown. */
  linked: boolean
  children: ReactNode
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-control)] border border-[var(--line)]">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cn(
                  label,
                  'border-b border-[var(--line)] bg-[var(--surface-hover)] px-3 py-2.5 font-normal whitespace-nowrap',
                  right.includes(i) && 'text-right'
                )}
              >
                {h}
              </th>
            ))}
            {linked && (
              <th
                scope="col"
                className="w-8 border-b border-[var(--line)] bg-[var(--surface-hover)]"
              >
                <span className="sr-only">Open</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">{children}</tbody>
      </table>
    </div>
  )
}

/** A row whose name links to the detail page when it exists. */
function Row({
  href,
  name,
  prefix,
  cells,
  right = []
}: {
  href: Route | null
  name: string
  prefix?: ReactNode
  cells: ReactNode[]
  right?: number[]
}) {
  return (
    <tr className={cn(href && 'relative hover:bg-[var(--surface)]')}>
      <th scope="row" className="px-3 py-2.5 text-left font-normal">
        <span className="flex items-center gap-1.5">
          {prefix}
          {href ? (
            <Link
              href={href}
              className="font-medium break-words after:absolute after:inset-0 focus-visible:outline-hidden focus-visible:after:ring-2 focus-visible:after:ring-[var(--focus)] focus-visible:after:ring-inset"
            >
              {name}
            </Link>
          ) : (
            <span className="font-medium break-words">{name}</span>
          )}
        </span>
      </th>
      {cells.map((cell, i) => (
        <td
          key={i}
          className={cn(
            'px-3 py-2.5 whitespace-nowrap',
            right.includes(i + 1) && 'text-right tabular-nums'
          )}
        >
          {cell}
        </td>
      ))}
      {href && (
        <td className="px-2 text-[var(--text-muted)]">
          <ChevronRight className="size-4" aria-hidden />
        </td>
      )}
    </tr>
  )
}

const campaignTone: Record<KlaviyoCampaign['status'], PillTone> = {
  sent: 'solid',
  scheduled: 'info',
  draft: 'warning',
  cancelled: 'danger'
}

function detailHref(
  links: DetailLinks,
  kind: keyof DetailLinks,
  id: string
): Route | null {
  if (!links[kind]) return null
  // Local campaigns own /campaigns/:id; Klaviyo campaigns live under klaviyo/.
  const base = kind === 'campaigns' ? '/campaigns/klaviyo' : `/${kind}`
  return `${base}/${id}?from=${kind}` as Route
}

export function KlaviyoDataCard({
  snapshot,
  tab,
  tabHrefs,
  timezone,
  links = {},
  credits
}: {
  snapshot: KlaviyoSnapshot
  tab: KlaviyoTab
  /** Each tab's link; built by the page so other dashboard state is kept. */
  tabHrefs: Record<KlaviyoTab, Route>
  /** The one brand timezone. */
  timezone: string
  links?: DetailLinks
  /** AI credits, or null when this viewer may not see them. */
  credits: Credits | null
}) {
  const tz = timezone
  const date = (value: string | null) => formatBrandDate(value, tz) ?? '—'
  const summary = revenueSummary(snapshot)
  const counts: Record<KlaviyoTab, number | null> = {
    overview: null,
    lists: snapshot.lists.length,
    segments: snapshot.segments.length,
    campaigns: snapshot.campaigns.length,
    flows: snapshot.flows.length,
    metrics: snapshot.metrics.length
  }
  return (
    <section
      id="klaviyo-data"
      aria-labelledby="klaviyo-data-title"
      className="mt-5 scroll-mt-6 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Database className="size-5 text-[var(--text-muted)]" aria-hidden />
        <h2 id="klaviyo-data-title" className="text-base font-semibold">
          Detailed Klaviyo data
        </h2>
        <p className="ml-auto text-sm text-[var(--text-muted)]">
          Lists, segments, campaigns, flows, metrics
        </p>
      </div>
      {credits && <CreditsIndicator className="mt-4" {...credits} />}
      {tab === 'overview' && <RevenueChart snapshot={snapshot} timezone={tz} />}
      <nav
        aria-label="Klaviyo data"
        className="mt-6 overflow-x-auto border-b border-[var(--line)]"
      >
        <ul className="flex min-w-max gap-1">
          {klaviyoTabs.map((key) => {
            const Icon = tabMeta[key].icon
            const current = key === tab
            return (
              <li key={key}>
                <Link
                  href={tabHrefs[key]}
                  scroll={false}
                  aria-current={current ? 'page' : undefined}
                  className="-mb-px flex min-h-11 items-center gap-2 border-b-2 border-transparent px-3 text-sm text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden aria-[current=page]:border-[var(--text)] aria-[current=page]:font-medium aria-[current=page]:text-[var(--text)]"
                >
                  <Icon className="size-4" aria-hidden />
                  {tabMeta[key].text}
                  {counts[key] !== null && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[0.6875rem] leading-none tabular-nums',
                        current
                          ? 'bg-[var(--text)] text-[var(--surface-raised)]'
                          : 'bg-[var(--surface-hover)] text-[var(--text-muted)]'
                      )}
                    >
                      {counts[key]}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="mt-5">
        {tab === 'overview' && (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {(
                [
                  ['Lists', counts.lists, 'lists', 'view all'],
                  ['Segments', counts.segments, 'segments', 'view all'],
                  ['Campaigns', counts.campaigns, 'campaigns', 'view all'],
                  [
                    'Flows',
                    counts.flows,
                    null,
                    `${summary.liveFlows} live · ${summary.draftFlows} draft`
                  ],
                  ['Metrics', counts.metrics, null, 'event types']
                ] as const
              ).map(([name, value, target, caption]) => (
                <div
                  key={name}
                  className="rounded-[var(--radius-control)] border border-[var(--line)] p-3"
                >
                  <dt className={label}>{name}</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {value}
                  </dd>
                  <dd className="text-xs text-[var(--text-muted)]">
                    {target ? (
                      <Link
                        href={tabHrefs[target]}
                        scroll={false}
                        className="underline underline-offset-4 hover:text-[var(--text)]"
                      >
                        {caption}
                        <span className="sr-only"> {name.toLowerCase()}</span>
                      </Link>
                    ) : (
                      caption
                    )}
                  </dd>
                </div>
              ))}
              <div className="rounded-[var(--radius-control)] border border-[var(--line)] p-3">
                <dt className={label}>Industry</dt>
                <dd className="mt-1 text-sm font-semibold break-words">
                  {snapshot.account.industry}
                </dd>
              </div>
            </dl>
            <section
              aria-label="Account"
              className="mt-4 rounded-[var(--radius-control)] border border-[var(--line)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Account</h3>
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  <span className="sr-only">Public key </span>
                  {snapshot.account.maskedKey}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(
                  [
                    ['Organization', snapshot.account.organization],
                    ['Industry', snapshot.account.industry],
                    ['Timezone', timezoneLabel(tz)],
                    ['Currency', snapshot.account.currency],
                    ['Locale', snapshot.account.locale]
                  ] as const
                ).map(([name, value]) => (
                  <div key={name} className="min-w-0">
                    <dt className={label}>{name}</dt>
                    <dd className="mt-0.5 text-sm break-words">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <p className="mt-4 rounded-[var(--radius-control)] bg-[var(--surface-hover)] px-4 py-3 text-sm">
              <strong>What&apos;s next:</strong> Switch tabs above to drill into{' '}
              {(
                ['lists', 'segments', 'campaigns', 'flows', 'metrics'] as const
              ).map((key, i, all) => (
                <span key={key}>
                  <Link
                    href={tabHrefs[key]}
                    scroll={false}
                    className="underline underline-offset-4"
                  >
                    {key}
                  </Link>
                  {i < all.length - 2
                    ? ', '
                    : i === all.length - 2
                      ? ', or '
                      : ''}
                </span>
              ))}
              .{' '}
              {Object.values(links).some(Boolean)
                ? 'Click any row inside a tab to see full details.'
                : 'Full detail pages for each row are coming next.'}
            </p>
          </>
        )}
        {tab === 'lists' && (
          <Table
            linked={Boolean(links.lists)}
            caption="Lists"
            headers={['Name', 'Profiles', 'Opt-in', 'Updated', 'Created']}
            right={[1]}
          >
            {snapshot.lists.map((l) => (
              <Row
                key={l.id}
                href={detailHref(links, 'lists', l.id)}
                name={l.name}
                right={[1]}
                cells={[
                  formatCount(l.profileCount),
                  l.optIn === 'double' ? 'Double opt-in' : 'Single opt-in',
                  date(l.updated),
                  date(l.created)
                ]}
              />
            ))}
          </Table>
        )}
        {tab === 'segments' && (
          <Table
            linked={Boolean(links.segments)}
            caption="Segments"
            headers={['Name', 'Profiles', 'State', 'Updated', 'Created']}
            right={[1]}
          >
            {snapshot.segments.map((s) => (
              <Row
                key={s.id}
                href={detailHref(links, 'segments', s.id)}
                name={s.name}
                prefix={
                  s.starred ? (
                    <Star
                      className="size-4 shrink-0 text-[var(--text-muted)]"
                      aria-label="Starred"
                      role="img"
                    />
                  ) : undefined
                }
                right={[1]}
                cells={[
                  formatCount(s.profileCount),
                  s.active ? (
                    <Pill tone="success">Active</Pill>
                  ) : (
                    <Pill>Inactive</Pill>
                  ),
                  date(s.updated),
                  date(s.created)
                ]}
              />
            ))}
          </Table>
        )}
        {tab === 'campaigns' && (
          <>
            <p className="mb-3 text-sm text-[var(--text-muted)]">
              30d revenue:{' '}
              <strong className="text-[var(--text)]">
                {formatMoney(summary.campaigns)}
              </strong>{' '}
              · newest first · times in {timezoneLabel(tz)}
            </p>
            <Table
              linked={Boolean(links.campaigns)}
              caption="Campaigns, newest first"
              headers={['Name', 'Status', 'Revenue (30d)', 'Send time']}
              right={[2]}
            >
              {campaignsNewestFirst(snapshot.campaigns).map((c) => (
                <Row
                  key={c.id}
                  href={detailHref(links, 'campaigns', c.id)}
                  name={c.name}
                  right={[2]}
                  cells={[
                    <Pill key="s" tone={campaignTone[c.status]}>
                      {c.status}
                    </Pill>,
                    c.revenue30d ? formatMoney(c.revenue30d) : '—',
                    c.sendTime
                      ? (formatBrandDateTime(c.sendTime, tz) ?? '—')
                      : 'Not scheduled'
                  ]}
                />
              ))}
            </Table>
          </>
        )}
        {tab === 'flows' && (
          <>
            <p className="mb-3 text-sm text-[var(--text-muted)]">
              30d revenue:{' '}
              <strong className="text-[var(--text)]">
                {formatMoney(summary.flows)}
              </strong>{' '}
              ·{' '}
              <span className="text-success" aria-hidden>
                ●
              </span>{' '}
              {summary.liveFlows} live ·{' '}
              <span className="text-[var(--warning-ink)]" aria-hidden>
                ●
              </span>{' '}
              {summary.draftFlows} draft
            </p>
            <Table
              linked={Boolean(links.flows)}
              caption="Flows"
              headers={['Name', 'Trigger', 'Status', 'Revenue (30d)']}
              right={[3]}
            >
              {snapshot.flows.map((f) => (
                <Row
                  key={f.id}
                  href={detailHref(links, 'flows', f.id)}
                  name={f.name}
                  right={[3]}
                  cells={[
                    f.trigger.kind === 'list'
                      ? `Added to list: ${f.trigger.name}`
                      : `Metric: ${f.trigger.name}`,
                    <Pill
                      key="s"
                      tone={f.status === 'live' ? 'success' : 'warning'}
                    >
                      {f.status}
                    </Pill>,
                    formatMoney(f.revenue30d)
                  ]}
                />
              ))}
            </Table>
          </>
        )}
        {tab === 'metrics' && (
          <Table
            linked={Boolean(links.metrics)}
            caption="Metrics"
            headers={['Name', 'Integration', 'Category', 'Created']}
          >
            {snapshot.metrics.map((m) => (
              <Row
                key={m.id}
                href={detailHref(links, 'metrics', m.id)}
                name={m.name}
                cells={[m.integration, m.category, date(m.created)]}
              />
            ))}
          </Table>
        )}
      </div>
    </section>
  )
}
