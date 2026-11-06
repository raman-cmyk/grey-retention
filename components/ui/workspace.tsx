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
  description
}: {
  title: string
  children: ReactNode
  className?: string
  id?: string
  action?: ReactNode
  description?: string
}) {
  return (
    <section
      id={id}
      className={cn(
        'min-w-0 scroll-mt-24 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-5 sm:p-6',
        className
      )}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-[-0.015em]">
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
        'rounded-lg border p-4 text-sm leading-6',
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
export const controlClass =
  'min-h-11 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-2 focus:ring-[var(--focus)]'
