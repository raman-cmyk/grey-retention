'use client'

import { Check } from 'lucide-react'
import { useId, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Input (BRAND.md): a soft box with a bold label above it, no border until
 * it is focused (forest) or wrong (signal, with one line saying what to
 * do). `found` shows a lime check at the right edge. On a white card the
 * fill is mist; on the mist page it is white (`onPage`).
 */
export function Field({
  label,
  error,
  found = false,
  onPage = false,
  id,
  className,
  'aria-describedby': describedBy,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> & {
  label: string
  /** What is wrong and what to do, in one sentence. */
  error?: string | null
  found?: boolean
  onPage?: boolean
}) {
  const own = useId()
  const fieldId = id ?? own
  const errorId = `${fieldId}-error`
  const foundId = `${fieldId}-found`
  const shown = found && !error
  const description =
    [describedBy, error ? errorId : null, shown ? foundId : null]
      .filter(Boolean)
      .join(' ') || undefined
  return (
    <div className={cn('flex flex-col gap-[var(--space-2)]', className)}>
      <label htmlFor={fieldId} className="gros-field-label text-[var(--ink)]">
        {label}
      </label>
      <div className="relative">
        <input
          {...input}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={description}
          className={cn(
            'gros-input w-full text-[var(--ink)] focus:bg-[var(--white)]',
            onPage ? 'bg-[var(--white)]' : 'bg-[var(--mist)]',
            shown && 'pr-[var(--space-12)]'
          )}
        />
        {shown ? (
          <span className="gros-found absolute top-1/2 right-[var(--space-4)] flex -translate-y-1/2 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--lime)] text-[var(--forest)]">
            <Check aria-hidden size={16} strokeWidth={2} />
            <span id={foundId} className="sr-only">
              Found
            </span>
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="type-caption text-[var(--signal-ink)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}
