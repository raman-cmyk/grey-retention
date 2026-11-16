import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Card (BRAND.md): a white rounded surface on the mist page that answers
 * one question, usually with one big number; at most one main button. The
 * `lime` card (one per screen at most) holds the number the owner is
 * proudest of, all its text forest, with two or three lime-deep rings off
 * its top right corner. Never a card inside a card, never a divider.
 */
export function Card({
  tone = 'white',
  size = 'large',
  className,
  children,
  label
}: {
  tone?: 'white' | 'lime'
  size?: 'large' | 'small'
  className?: string
  children: ReactNode
  /** What the card answers, for screen readers when it has no heading. */
  label?: string
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        'relative overflow-hidden rounded-[var(--radius-lg)]',
        size === 'large' ? 'p-[var(--space-8)]' : 'p-[var(--space-7)]',
        tone === 'lime'
          ? 'bg-[var(--lime)] text-[var(--forest)]'
          : 'bg-[var(--white)] text-[var(--ink)]',
        className
      )}
    >
      {tone === 'lime' ? <Rings /> : null}
      <div className="relative">{children}</div>
    </section>
  )
}

/** The only decoration: lime-deep rings bleeding off a lime card's corner. */
function Rings() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 220 220"
      className="gros-rings pointer-events-none absolute"
    >
      {[70, 100, 130].map((r) => (
        <circle
          key={r}
          cx="160"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--lime-deep)"
          strokeWidth="14"
        />
      ))}
    </svg>
  )
}

/**
 * Tile: a small box inside a card, holding a label and a medium number.
 * Mist inside a white card, lime-tile inside the lime card.
 */
export function Tile({
  label,
  value,
  onLime = false,
  className
}: {
  label: string
  value: ReactNode
  onLime?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'gros-tile flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)]',
        onLime
          ? 'bg-[var(--lime-tile)] text-[var(--forest)]'
          : 'bg-[var(--mist)] text-[var(--ink)]',
        className
      )}
    >
      <span
        className={cn(
          'type-label',
          onLime ? 'text-[var(--forest)]' : 'text-[var(--stone)]'
        )}
      >
        {label}
      </span>
      <span className="type-number-md">{value}</span>
    </div>
  )
}

/** A change badge beside a number, for example +18%. */
export function ChangeBadge({ value }: { value: string }) {
  return (
    <span className="gros-badge inline-flex items-center rounded-[var(--radius-pill)] bg-[var(--white)] text-[var(--ink)]">
      {value}
    </span>
  )
}
