import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Empty state from docs/DESIGN.md: one serif line that says what is missing,
 * one plain sentence that says what to do, and at most one action.
 */
export function EmptyState({
  title,
  description,
  action,
  headingLevel = 3,
  className
}: {
  title: string
  description: ReactNode
  action?: ReactNode
  headingLevel?: 2 | 3
  className?: string
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div
      className={cn(
        'rounded-[var(--radius-panel)] border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-5 py-8 sm:px-8 sm:py-10',
        className
      )}
    >
      <Heading className="tracking-display font-serif text-2xl leading-tight font-normal">
        {title}
      </Heading>
      <p className="mt-2 max-w-[60ch] text-sm leading-6 text-[var(--text-muted)]">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
