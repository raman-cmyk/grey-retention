import Link from 'next/link'
import type { Route } from 'next'
import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const columnClasses = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4'
} as const

/**
 * A grid of stat tiles that share 1px hairlines, like a printed table
 * (docs/DESIGN.md → Stat tiles). It is a description list: each tile is a
 * `div` holding one `dt` and one `dd`. Choose `columns` so every row is full.
 */
export function StatGrid({
  children,
  className,
  label,
  columns = 3
}: {
  children: ReactNode
  className?: string
  /** Accessible name for the group of numbers. */
  label?: string
  columns?: keyof typeof columnClasses
}) {
  return (
    <dl
      aria-label={label}
      className={cn(
        'grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--line)]',
        columnClasses[columns],
        className
      )}
    >
      {children}
    </dl>
  )
}

/**
 * Show a count that came from a capped query honestly: "100+" when the list
 * reached its limit, otherwise the exact number.
 */
export function cappedCount(count: number, limit: number) {
  return count >= limit ? `${limit}+` : count
}

/**
 * One number with a mono uppercase label and a short caption. Unknown values
 * show "—" and say why, never "0". A linked tile is clickable as a whole; its
 * link is named by the label and the number.
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
  const id = useId()
  const unknown = value === null || value === undefined
  const note = unknown ? (unknownReason ?? 'Not known yet') : caption
  const number = (
    <span
      id={`${id}-value`}
      className="font-mono text-[length:var(--gr-text-stat)] leading-none font-normal tracking-tight text-[var(--text)] tabular-nums"
    >
      {unknown ? '—' : value}
    </span>
  )
  return (
    <div
      className={cn(
        'relative bg-[var(--surface-raised)] p-5 sm:p-6',
        href &&
          'transition-colors focus-within:ring-2 focus-within:ring-[var(--focus)] focus-within:ring-inset hover:bg-[var(--surface)]'
      )}
    >
      <dt
        id={`${id}-label`}
        className="tracking-label font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase"
      >
        {label}
      </dt>
      <dd className="mt-3">
        {href ? (
          <Link
            href={href}
            aria-labelledby={`${id}-label ${id}-value`}
            aria-describedby={note ? `${id}-note` : undefined}
            className="outline-none after:absolute after:inset-0"
          >
            {number}
          </Link>
        ) : (
          number
        )}
        {note && (
          <span
            id={`${id}-note`}
            className="mt-2 block text-sm leading-5 text-[var(--text-muted)]"
          >
            {note}
          </span>
        )}
      </dd>
    </div>
  )
}
