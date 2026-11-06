import {
  CalendarDays,
  Clock3,
  Info,
  Medal,
  RefreshCw,
  Sparkles
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/detail-page'
import { Pill } from '@/components/ui/pill'
import {
  formatBrandDateTime,
  relativeTime,
  timezoneLabel
} from '@/lib/brand-time'
import { cn } from '@/lib/utils'
import { countdown, type Kpi, type UpcomingSend } from './model'

const label =
  'tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'

/** Page header: title, subtitle, sample-data note, last sync and Refresh. */
export function DashboardHeader({
  syncedAt,
  sample,
  now
}: {
  syncedAt: string | null
  sample: boolean
  now: Date
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1 basis-72">
        <h1 className="tracking-display font-serif text-[1.875rem] leading-tight font-normal">
          Dashboard
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Retention health at a glance.
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {sample && (
            <>
              <strong className="font-semibold text-[var(--warning-ink)]">
                Sample Klaviyo data
              </strong>{' '}
              — not a real account.{' '}
            </>
          )}
          {syncedAt
            ? `Last synced ${relativeTime(syncedAt, now)}.`
            : 'Klaviyo is not connected yet.'}
        </p>
      </div>
      <Button asChild variant="outline" shape="pill">
        <Link href={'/dashboard?refresh=1' as Route} prefetch={false}>
          <RefreshCw className="size-4" aria-hidden />
          Refresh
        </Link>
      </Button>
    </header>
  )
}

export function KpiStrip({ kpis }: { kpis: Kpi[] }) {
  return (
    <section aria-label="Key numbers" className="mb-5 overflow-x-auto pb-1">
      <dl className="flex min-w-max gap-3 lg:grid lg:min-w-0 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="w-44 shrink-0 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-4 lg:w-auto"
          >
            <dt className={cn(label, 'truncate')} title={kpi.label}>
              {kpi.label}
            </dt>
            <dd className="mt-2 text-2xl font-semibold tabular-nums">
              {kpi.value}
            </dd>
            <dd
              className={cn(
                'mt-1 text-xs',
                kpi.trend === 'up'
                  ? 'text-success'
                  : kpi.trend === 'down'
                    ? 'text-[var(--danger-ink)]'
                    : 'text-[var(--text-muted)]'
              )}
            >
              {kpi.caption}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Semicircle gauge: revenue this month against the goal. */
function Gauge({ fraction }: { fraction: number }) {
  const length = Math.PI * 80
  return (
    <svg
      viewBox="0 0 200 110"
      className="mx-auto block w-full max-w-60"
      aria-hidden
    >
      <path
        d="M 20 100 A 80 80 0 0 1 180 100"
        fill="none"
        stroke="var(--line)"
        strokeWidth="14"
        strokeLinecap="round"
      />
      {fraction > 0 && (
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke="var(--brand-primary)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${fraction * length} ${length}`}
        />
      )}
    </svg>
  )
}

const attributionHelp = {
  klaviyo:
    'Klaviyo $flow and $campaign attribution (last 30d, clamped to month to date)',
  utm: 'Shopify orders with utm_source=klaviyo or utm_medium=email (month to date)'
}

export function RevenueCard({
  attribution,
  value,
  goal,
  fraction,
  shopifyConnected
}: {
  attribution: 'klaviyo' | 'utm'
  value: string
  goal: string | null
  fraction: number
  shopifyConnected: boolean
}) {
  const option = (key: 'klaviyo' | 'utm', text: string) => (
    <Link
      href={`/dashboard?attr=${key}` as Route}
      aria-current={attribution === key ? 'true' : undefined}
      title={attributionHelp[key]}
      scroll={false}
      className="rounded-[calc(var(--radius-control)-2px)] px-3 py-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none aria-[current=true]:bg-[var(--brand-primary)] aria-[current=true]:text-[var(--on-brand)]"
    >
      {text}
    </Link>
  )
  const utmMissing = attribution === 'utm' && !shopifyConnected
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={label}>Email revenue this month</h2>
        <nav
          aria-label="Revenue attribution"
          className="flex gap-1 rounded-[var(--radius-control)] border border-[var(--line)] p-0.5"
        >
          {option('klaviyo', 'Klaviyo')}
          {option('utm', 'UTM')}
        </nav>
      </div>
      <div className="relative mt-4">
        <Gauge fraction={utmMissing ? 0 : fraction} />
        <div className="absolute inset-x-0 bottom-0 text-center">
          <p className="text-2xl font-semibold tabular-nums">
            {utmMissing ? '—' : value}
          </p>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-[var(--text-muted)]">
        {utmMissing
          ? 'UTM attribution needs Shopify.'
          : goal
            ? `of ${goal} goal`
            : 'No monthly goal set yet.'}
      </p>
      {utmMissing && (
        <p className="mt-2 text-center text-sm">
          <Link
            href="/connections"
            className="font-medium underline underline-offset-4"
          >
            Connect Shopify →
          </Link>
        </p>
      )}
    </Card>
  )
}

export function NextCampaignCard({
  next,
  timezone,
  now
}: {
  next: UpcomingSend | null
  timezone: string
  now: Date
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Clock3 className="size-5 text-[var(--text-muted)]" aria-hidden />
        <h2 className={label}>Next campaign</h2>
      </div>
      {next ? (
        <div className="mt-4">
          <p className="text-2xl font-semibold">{countdown(next.at, now)}</p>
          <p className="mt-2 text-sm break-words">
            {next.href ? (
              <Link
                href={next.href}
                className="font-medium underline-offset-4 hover:underline"
              >
                {next.name}
              </Link>
            ) : (
              <span className="font-medium">{next.name}</span>
            )}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {formatBrandDateTime(next.at, timezone)} ({timezoneLabel(timezone)})
            ·{' '}
            {next.source === 'klaviyo'
              ? 'Klaviyo (sample)'
              : 'In this workspace'}
          </p>
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-2xl font-semibold">—</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            No scheduled or planned campaigns. Plan one to see the countdown.
          </p>
          <Link
            href="/first-draft"
            className="mt-3 inline-block text-sm font-medium underline underline-offset-4"
          >
            Create a campaign →
          </Link>
        </div>
      )}
    </Card>
  )
}

export function CalendarMiniCard({
  sends,
  timezone
}: {
  sends: UpcomingSend[]
  timezone: string
}) {
  const shown = sends.slice(0, 50)
  return (
    <Card>
      <div className="flex items-center gap-2">
        <CalendarDays className="size-5 text-[var(--text-muted)]" aria-hidden />
        <h2 className={label}>Campaign calendar</h2>
        <Link
          href="/campaign-agent"
          className="ml-auto text-sm font-medium underline-offset-4 hover:underline"
        >
          View all
        </Link>
      </div>
      {shown.length ? (
        <ul className="mt-3 max-h-56 divide-y divide-[var(--line)] overflow-y-auto">
          {shown.map((send) => (
            <li key={`${send.source}-${send.id}`} className="py-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {send.href ? (
                    <Link
                      href={send.href}
                      className="text-sm font-medium break-words underline-offset-4 hover:underline"
                    >
                      {send.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium break-words">
                      {send.name}
                    </span>
                  )}
                  <p className="text-xs text-[var(--text-muted)]">
                    {formatBrandDateTime(send.at, timezone)}
                  </p>
                </div>
                {send.source === 'klaviyo' && <Pill tone="info">Klaviyo</Pill>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-[var(--text-muted)]">
          No upcoming campaigns.{' '}
          <Link
            href="/first-draft"
            className="font-medium text-[var(--text)] underline underline-offset-4"
          >
            Create one →
          </Link>
        </p>
      )}
      {sends.length > shown.length && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          And {sends.length - shown.length} more in the calendar.
        </p>
      )}
    </Card>
  )
}

/**
 * The old app's placeholder ("approval workflow not yet built") becomes the
 * real list of campaigns waiting for the owner (docs/OWNER_JOURNEYS.md §18.4).
 */
export function ApprovalsCard({
  waiting,
  owner
}: {
  waiting: { id: string; title: string; step: string }[]
  owner: boolean
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Medal className="size-5 text-[var(--text-muted)]" aria-hidden />
        <h2 className={label}>
          {owner ? 'Waiting for you' : 'Waiting for the owner'}
        </h2>
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums">
        {waiting.length}
      </p>
      {waiting.length ? (
        <ul className="mt-2 space-y-1.5 text-sm">
          {waiting.slice(0, 3).map((c) => (
            <li key={c.id} className="break-words">
              <Link
                href={`/campaigns/${c.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {c.title}
              </Link>{' '}
              <span className="text-[var(--text-muted)]">· {c.step}</span>
            </li>
          ))}
          {waiting.length > 3 && (
            <li>
              <Link
                href={'/dashboard?focus=review#your-campaigns' as Route}
                className="text-[var(--text-muted)] underline underline-offset-4"
              >
                See all {waiting.length}
              </Link>
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Nothing needs approval right now.
        </p>
      )}
    </Card>
  )
}

export function InsightCard({
  insight,
  shown
}: {
  insight: string
  shown: boolean
}) {
  return (
    <Card className="lg:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--inverse)] px-2.5 py-1 text-xs font-semibold text-[var(--on-inverse)]">
          <Sparkles className="size-3.5" aria-hidden /> GROS
          <span className="bg-success size-1.5 rounded-full" aria-hidden />
        </span>
        <Link
          href={'/dashboard?insight=1' as Route}
          scroll={false}
          title="Writes a short insight from your numbers. No AI credits are used while the AI is in sample mode."
          className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
        >
          <RefreshCw className="size-4" aria-hidden />
          Generate
        </Link>
      </div>
      {shown ? (
        <>
          <p className="mt-4 text-base leading-7">{insight}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Info className="size-3.5" aria-hidden />
            Written from your numbers. No AI was used.
          </p>
        </>
      ) : (
        <p className="mt-4 text-sm leading-6 text-[var(--text-muted)] italic">
          Click “Generate” to get a short insight on your retention performance,
          written from your current numbers.
        </p>
      )}
    </Card>
  )
}
