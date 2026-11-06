'use client'

import { Check, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { controlClass } from './control'
import { Pill } from './pill'

export type AudienceOption = {
  id: string
  name: string
  kind: 'list' | 'segment'
}

/**
 * List/segment picker (docs/UI_REBUILD_SPEC.md §2): `SEND TO  N SELECTED`
 * with Clear, a search box, and a scrolling checklist of round checkboxes
 * with a LIST or SEGMENT tag. Selected ids are submitted as `name` fields,
 * and the selection never changes when the search hides an option.
 */
export function AudiencePicker({
  label,
  name,
  options,
  value,
  onChange,
  maxHeight = 260
}: {
  label: string
  name: string
  options: readonly AudienceOption[]
  value: readonly string[]
  onChange: (next: string[]) => void
  maxHeight?: number
}) {
  const [query, setQuery] = useState('')
  const known = useMemo(() => new Set(options.map((o) => o.id)), [options])
  const selected = value.filter((v) => known.has(v))
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options
  }, [options, query])
  const toggle = (optionId: string, checked: boolean) =>
    onChange(
      checked ? [...selected, optionId] : selected.filter((v) => v !== optionId)
    )
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{label}</legend>
      <div className="flex items-center gap-3">
        <p className="tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase">
          <span aria-hidden>{label}</span>
          <span className="ml-2 text-[var(--text)]" aria-live="polite">
            {selected.length} selected
          </span>
        </p>
        {selected.length > 0 && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={() => onChange([])}
            className="ml-auto text-sm text-[var(--text-muted)] underline-offset-4 hover:text-[var(--text)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
          >
            Clear
          </button>
        )}
      </div>
      <div className="relative mt-2">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
        />
        <input
          type="search"
          aria-label={`Search lists and segments for ${label}`}
          placeholder="Search lists & segments..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={`${controlClass} w-full pl-9`}
        />
      </div>
      <div
        className="mt-2 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--line)]"
        style={{ maxHeight }}
      >
        {options.length === 0 ? (
          <p className="p-4 text-sm text-[var(--text-muted)]">
            No lists or segments yet. Connect Klaviyo to see them here.
          </p>
        ) : shown.length === 0 ? (
          <p className="p-4 text-sm text-[var(--text-muted)]" role="status">
            No lists or segments match “{query.trim()}”.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {shown.map((option) => {
              const checked = selected.includes(option.id)
              return (
                <li key={option.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--surface-hover)]">
                    <span className="relative grid size-[18px] shrink-0 place-items-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          toggle(option.id, event.target.checked)
                        }
                        className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-full border border-[var(--line-strong)] bg-[var(--surface-raised)] checked:border-[var(--brand-primary)] checked:bg-[var(--brand-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-1 focus-visible:outline-none forced-colors:appearance-auto"
                      />
                      <Check
                        aria-hidden
                        strokeWidth={3}
                        className="pointer-events-none relative size-3 text-[var(--on-brand)] opacity-0 peer-checked:opacity-100 forced-colors:hidden"
                      />
                    </span>
                    <span className="min-w-0 flex-1 break-words">
                      {option.name}
                    </span>
                    <Pill>{option.kind === 'list' ? 'List' : 'Segment'}</Pill>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {selected.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
    </fieldset>
  )
}
