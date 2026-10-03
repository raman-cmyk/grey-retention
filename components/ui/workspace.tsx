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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line-strong)] pb-6">
      <div>
        <p className="mb-2 text-xs tracking-wide text-[var(--text-muted)] uppercase">
          Retention workspace
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
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
  className
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-5 sm:p-6',
        className
      )}
    >
      <h2 className="mb-5 text-lg font-semibold">{title}</h2>
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
          ? 'border-[var(--danger)] text-[var(--danger)]'
          : 'border-[var(--line)] text-[var(--text-muted)]'
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
