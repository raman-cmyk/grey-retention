import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Report layout from docs/DESIGN.md: a dark panel on the left with a serif
 * headline and the one-sentence takeaway, a light data panel on the right.
 * Stacks vertically below 768px.
 */
export function SplitSection({
  eyebrow,
  title,
  takeaway,
  children,
  className
}: {
  eyebrow?: string
  title: string
  takeaway: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'grid overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line)] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]',
        className
      )}
    >
      <div className="bg-[var(--inverse)] p-6 text-[var(--on-inverse)] sm:p-8">
        {eyebrow && (
          <p className="tracking-label font-mono text-[0.6875rem] text-[var(--on-inverse-muted)] uppercase">
            {eyebrow}
          </p>
        )}
        <h2 className="tracking-display mt-3 font-serif text-2xl leading-tight font-normal sm:text-3xl">
          {title}
        </h2>
        <p className="mt-4 text-sm leading-6 text-[var(--on-inverse-muted)]">
          {takeaway}
        </p>
      </div>
      <div className="min-w-0 bg-[var(--surface-raised)] p-4 sm:p-6">
        {children}
      </div>
    </section>
  )
}
