import { ChevronRight } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Pill } from '@/components/ui/pill'
import { relativeTime } from '@/lib/brand-time'
import { cn } from '@/lib/utils'
import { DueText } from './due-text'
import {
  deskFilterLabels,
  deskFilters,
  emptyDeskWords,
  type DeskFilter,
  type deskModel
} from './model'

type Desk = ReturnType<typeof deskModel>

export function deskHref(filter: DeskFilter) {
  return `/designer/dashboard?show=${filter}` as Route
}

/** Status tabs with counts; each is a link, so the choice survives reloads. */
export function DeskTabs({
  filter,
  counts
}: {
  filter: DeskFilter
  counts: Desk['counts']
}) {
  return (
    <nav aria-label="Assignment status" className="mb-4 overflow-x-auto">
      <ul className="flex min-w-max gap-2">
        {deskFilters.map((f) => {
          const current = f === filter
          return (
            <li key={f}>
              <Link
                href={deskHref(f)}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'tracking-label inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 font-mono text-[0.6875rem] uppercase focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden',
                  current
                    ? 'border-[var(--inverse)] bg-[var(--inverse)] text-[var(--on-inverse)]'
                    : 'border-[var(--line-strong)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--text)]'
                )}
              >
                {deskFilterLabels[f]} <span>({counts[f]})</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** One row per brief; the whole row opens it. */
export function DeskList({
  rows,
  filter
}: {
  rows: Desk['rows']
  filter: DeskFilter
}) {
  if (!rows.length)
    return (
      <EmptyState
        title={emptyDeskWords[filter].title}
        description={emptyDeskWords[filter].description}
      />
    )
  return (
    <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)]">
      {rows.map((r) => (
        <li key={r.id}>
          <Link
            href={`/designer/assignments/${r.id}` as Route}
            className="flex items-center gap-4 px-5 py-4 hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden focus-visible:ring-inset"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold break-words">{r.title}</p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {r.brand ? `${r.brand} · ` : ''}Approved copy v{r.copyRevision}
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Pill tone={r.status.tone} title={r.status.meaning}>
                  {r.status.label}
                </Pill>
                {r.due && <DueText due={r.due} />}
              </p>
            </div>
            <ChevronRight
              className="size-4 shrink-0 text-[var(--text-muted)]"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  )
}

export type DeskNotification = {
  id: string
  message: string
  created_at: string
}

/** Notices sent to the designer. Email is simulated, and the list says so. */
export function DeskNotifications({
  items,
  now
}: {
  items: DeskNotification[]
  now: Date
}) {
  return (
    <Card title="Notifications">
      {items.length ? (
        <ul className="space-y-3 text-sm">
          {items.map((n) => (
            <li key={n.id}>
              <p className="break-words">{n.message}</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {[relativeTime(n.created_at, now), 'Email delivery simulated']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          No notifications yet. Assignments and owner feedback show up here.
        </p>
      )}
    </Card>
  )
}
