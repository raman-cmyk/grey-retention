'use client'

import { useId, type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * The admin forms' two fields that BRAND.md does not draw yet, on the GROS
 * tokens like the Settings ones (UI-SETd): a choice and a multi-line text,
 * each with a real label above it, mist on a white card and white on a
 * mist tile (`onTile`), and a forest ring on focus.
 */
const box = (onTile: boolean) =>
  cn(
    'type-body w-full rounded-[var(--radius-md)] border-2 border-transparent text-[var(--ink)] focus:border-[var(--forest)] focus:bg-[var(--white)] focus:outline-none',
    onTile ? 'bg-[var(--white)]' : 'bg-[var(--mist)]'
  )

export function SelectField({
  label,
  onTile = false,
  options,
  ...select
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  label: string
  onTile?: boolean
  options: readonly { value: string; label: string; disabled?: boolean }[]
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <label htmlFor={id} className="gros-field-label text-[var(--ink)]">
        {label}
      </label>
      <select
        {...select}
        id={id}
        className={cn(
          box(onTile),
          'min-h-[var(--control-sm)] px-[var(--space-4)]'
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function TextAreaField({
  label,
  name,
  rows = 3,
  onTile = false,
  required = true,
  minLength,
  maxLength = 5000
}: {
  label: string
  name: string
  rows?: number
  onTile?: boolean
  required?: boolean
  minLength?: number
  maxLength?: number
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <label htmlFor={id} className="gros-field-label text-[var(--ink)]">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        className={cn(box(onTile), 'px-[var(--space-4)] py-[var(--space-3)]')}
      />
    </div>
  )
}
