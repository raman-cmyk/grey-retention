import { cloneElement, isValidElement, useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
export function PageHeading({
  title,
  description,
  action
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-1 basis-72">
        <h1 className="tracking-display font-[family-name:var(--font-display)] text-3xl leading-tight font-normal break-words sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 max-w-[72ch] text-sm leading-6 text-[var(--text-muted)]">
          {description}
        </p>
      </div>
      {action}
    </header>
  )
}
export function Panel({
  title,
  children,
  className,
  id,
  action,
  description,
  eyebrow
}: {
  title: string
  children: ReactNode
  className?: string
  id?: string
  action?: ReactNode
  description?: string
  /** Optional mono uppercase label above the title. */
  eyebrow?: string
}) {
  return (
    <section
      id={id}
      className={cn(
        'min-w-0 scroll-mt-24 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:p-6',
        className
      )}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && (
            <p className="tracking-label mb-1.5 font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase">
              {eyebrow}
            </p>
          )}
          <h2 className="text-lg leading-snug font-medium tracking-[-0.01em]">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm leading-5 text-[var(--text-muted)]">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
export function Notice({
  children,
  error = false
}: {
  children: ReactNode
  error?: boolean
}) {
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={cn(
        'rounded-[var(--radius-control)] border p-4 text-sm leading-6',
        error
          ? 'border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger-ink)]'
          : 'border-[var(--line)] bg-[var(--surface-hover)] text-[var(--text-muted)]'
      )}
    >
      {children}
    </p>
  )
}
export function Field({
  label,
  children
}: {
  label: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="min-w-0 space-y-2 text-sm font-medium">
      <label htmlFor={id} className="block">
        {label}
      </label>
      {isValidElement<{ id?: string }>(children)
        ? cloneElement(children, { id })
        : children}
    </div>
  )
}
export { controlClass } from './control'
