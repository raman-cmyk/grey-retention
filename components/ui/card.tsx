import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The 20px-radius white card (docs/UI_REBUILD_SPEC.md §0), named by its title. */
export function Card({
  title,
  className,
  children
}: {
  title?: string
  className?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section
      aria-labelledby={title ? id : undefined}
      className={cn(
        'rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6',
        className
      )}
    >
      {title && (
        <h2 id={id} className="mb-4 text-base font-semibold">
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}
