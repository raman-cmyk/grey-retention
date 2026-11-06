import {
  ArrowLeft,
  ChevronRight,
  SlidersHorizontal,
  type LucideIcon
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  formatBrandDateTime,
  relativeTime,
  timezoneLabel
} from '@/lib/brand-time'
import { Card } from './card'

export { Card }

/**
 * Detail-page pattern for Klaviyo objects (docs/UI_REBUILD_SPEC.md §2):
 * a narrow ~1020px column, a muted back link with an optional Refresh on the
 * right, then the hero, stat and explainer cards, the timeline and the
 * Advanced details row. Where "back" goes is the page's choice (the
 * dashboard pages return to the tab the owner came from).
 */
export function DetailPage({
  backHref,
  backLabel,
  action,
  children
}: {
  backHref: Route
  backLabel: string
  /** Usually `<form action={…}><RefreshButton /></form>`. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-[var(--gr-detail-max)] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={backHref}
          className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] text-sm text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {backLabel}
        </Link>
        {action}
      </div>
      {children}
    </div>
  )
}

/** 44px inverted icon tile, tiny type label, large title, optional status. */
export function DetailHero({
  icon: Icon,
  kind,
  title,
  status,
  children
}: {
  icon: LucideIcon
  /** LIST, SEGMENT, CAMPAIGN, FLOW or METRIC (shown uppercase). */
  kind: string
  title: string
  status?: ReactNode
  children?: ReactNode
}) {
  return (
    <Card>
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-control)] bg-[var(--inverse)] text-[var(--on-inverse)]"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase">
            {kind}
          </p>
          <h1 className="tracking-display mt-1 font-serif text-[1.875rem] leading-tight font-normal break-words">
            {title}
          </h1>
          {status && <div className="mt-2">{status}</div>}
          {children && (
            <div className="mt-3 text-sm text-[var(--text-muted)]">
              {children}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function When({
  label,
  value,
  timezone,
  now
}: {
  label: string
  value: string | null | undefined
  timezone: string
  now: Date
}) {
  const formatted = formatBrandDateTime(value, timezone)
  return (
    <div>
      <dt className="tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase">
        {label}
      </dt>
      <dd className="mt-1">
        {formatted ? (
          <>
            <time dateTime={new Date(value!).toISOString()} className="text-sm">
              {formatted}{' '}
              <span className="text-[var(--text-muted)]">
                ({timezoneLabel(timezone)})
              </span>
            </time>
            <span className="block text-xs text-[var(--text-muted)]">
              {relativeTime(value, now)}
            </span>
          </>
        ) : (
          <span className="text-sm text-[var(--text-muted)]">Not known</span>
        )}
      </dd>
    </div>
  )
}

/** CREATED / LAST UPDATED in the brand timezone, with "4 weeks ago". */
export function TimelineCard({
  created,
  updated,
  timezone,
  now = new Date()
}: {
  created: string | null | undefined
  updated: string | null | undefined
  timezone: string
  now?: Date
}) {
  return (
    <Card title="Timeline">
      <dl className="grid gap-5 sm:grid-cols-2">
        <When label="Created" value={created} timezone={timezone} now={now} />
        <When
          label="Last updated"
          value={updated}
          timezone={timezone}
          now={now}
        />
      </dl>
    </Card>
  )
}

/** Shows any stored value as safe, bounded text (never as markup). */
export function attributeText(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : (() => {
            try {
              return JSON.stringify(value) ?? '[unreadable]'
            } catch {
              return '[unreadable]'
            }
          })()
  return text.length > 300 ? `${text.slice(0, 299)}…` : text
}

/**
 * Collapsed "Advanced details" row with the object id. Open, it lists every
 * attribute from Klaviyo and the linked resources ("none" when empty). Raw
 * values such as segment rules live here, not in the main cards
 * (docs/OWNER_JOURNEYS.md §18.9).
 */
export function AdvancedDetails({
  objectId,
  attributes,
  linked,
  source = 'Klaviyo'
}: {
  objectId: string
  attributes: Readonly<Record<string, unknown>>
  linked: readonly { label: string; items: readonly string[] }[]
  source?: string
}) {
  const entries = Object.entries(attributes).slice(0, 200)
  return (
    <details className="group rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)]">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-[var(--radius-panel)] px-6 focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 text-[var(--text-muted)] transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        <SlidersHorizontal
          className="size-5 text-[var(--text-muted)]"
          aria-hidden
        />
        <span className="text-sm font-semibold">Advanced details</span>
        <span className="ml-auto min-w-0 truncate font-mono text-xs text-[var(--text-muted)]">
          <span className="sr-only">ID </span>
          {objectId}
        </span>
      </summary>
      <div className="space-y-6 border-t border-[var(--line)] px-6 py-5">
        <section aria-label={`All attributes from ${source}`}>
          <h3 className="tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase">
            All attributes from {source}
          </h3>
          {entries.length ? (
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {entries.map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt className="font-mono text-xs text-[var(--text-muted)]">
                    {key}
                  </dt>
                  <dd className="mt-0.5 text-sm break-words">
                    {attributeText(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              No attributes.
            </p>
          )}
        </section>
        <section aria-label="Linked resources">
          <h3 className="tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase">
            Linked resources
          </h3>
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
            {linked.map((group) => (
              <div key={group.label}>
                <dt className="tracking-label font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase">
                  {group.label} · {group.items.length}{' '}
                  {group.items.length === 1 ? 'item' : 'items'}
                </dt>
                <dd className="mt-0.5 text-sm break-words">
                  {group.items.length ? group.items.join(', ') : 'none'}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </details>
  )
}
