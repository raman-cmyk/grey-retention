import type { ChangeEvent } from 'react'

/**
 * The chat's own fields on the GROS tokens (BRAND.md Input: a mist box on
 * the white card, a bold label above, a forest border on focus). BRAND.md
 * has only the one-line Input; these follow it for a choice and for a
 * question of several lines, as Settings does.
 */
const box =
  'type-body w-full rounded-[var(--radius-md)] border-2 border-transparent bg-[var(--mist)] px-[var(--space-4)] text-[var(--ink)] focus:border-[var(--forest)] focus:bg-[var(--white)] focus:outline-none'

export function Choice({
  id,
  label,
  name,
  options,
  value,
  defaultValue,
  onChange,
  required = false
}: {
  id: string
  label: string
  name: string
  options: readonly { value: string; label: string }[]
  /** Controlled (the composer's request), with `onChange`. */
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <label htmlFor={id} className="gros-field-label text-[var(--ink)]">
        {label}
      </label>
      <select
        id={id}
        name={name}
        required={required}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        onChange={
          onChange
            ? (event: ChangeEvent<HTMLSelectElement>) =>
                onChange(event.target.value)
            : undefined
        }
        className={`${box} min-h-[var(--control-sm)]`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function TextBox({
  id,
  label,
  name,
  rows
}: {
  id: string
  label: string
  name: string
  rows: number
}) {
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <label htmlFor={id} className="gros-field-label text-[var(--ink)]">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        maxLength={5000}
        required
        className={`${box} py-[var(--space-3)]`}
      />
    </div>
  )
}
