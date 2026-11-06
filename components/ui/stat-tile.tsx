import Link from 'next/link'
import type { Route } from 'next'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A grid of stat tiles that share 1px hairlines, like a printed table
 * (docs/DESIGN.md → Stat tiles). Renders a description list for screen readers.
 */
export function StatGrid({
  children,
  className,
  label
}: {
  children: ReactNode
  className?: string
  /** Accessible name for the group of numbers. */
  label?: string
}) {
  return (
    <dl
      aria-label={label}
      className={cn(
        'grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--line)] sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]',
        className
      )}
    >
      {children}
    </dl>
  )
}

/**
 * One number with a mono uppercase label and a short caption. Unknown values
 * show "—" and say why, never "0".
 */
export function StatTile({
  label,
  value,
  caption,
  unknownReason,
  href
}: {
  label: string
  value: number | string | null | undefined
  caption?: ReactNode
  /** Shown instead of the caption when the value is unknown. */
  unknownReason?: string
  href?: Route
}) {
  const unknown = value === null || value === undefined
  const body = (
    <>
      <dt className="tracking-label font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase">
        {label}
      </dt>
      <dd className="mt-3">
        <span className="font-mono text-[length:var(--gr-text-stat)] leading-none font-normal tracking-tight text-[var(--text)] tabular-nums">
          {unknown ? '—' : value}
        </span>
        {(unknown ? unknownReason : caption) && (
          <span className="mt-2 block text-sm leading-5 text-[var(--text-muted)]">
            {unknown ? (unknownReason ?? 'Not known yet') : caption}
          </span>
        )}
      </dd>
    </>
  )
  return (
    <div className="bg-[var(--surface-raised)]">
      {href ? (
        <Link
          href={href}
          className="block h-full p-5 transition-colors hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none focus-visible:ring-inset sm:p-6"
        >
          {body}
        </Link>
      ) : (
        <div className="h-full p-5 sm:p-6">{body}</div>
      )}
    </div>
  )
}
