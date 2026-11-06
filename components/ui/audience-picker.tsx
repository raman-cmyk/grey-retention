'use client'

import { Check } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Pill } from './pill'
import {
  PickerSearch,
  PickerStatus,
  unique,
  type PickerState
} from './picker-parts'

export type AudienceOption = {
  id: string
  name: string
  kind: 'list' | 'segment'
}

/**
 * List/segment picker (docs/UI_REBUILD_SPEC.md §2): `SEND TO  N SELECTED`
 * with Clear, a search box, and a scrolling checklist of round checkboxes
 * with a LIST or SEGMENT tag. Selected ids are submitted as `name` fields.
 *
 * Saved choices are never lost silently: while options load or fail, the
 * saved ids are still submitted; once loaded, ids that no longer exist are
 * named in a notice. A search never changes the selection.
 */
export function AudiencePicker({
  label,
  name,
  options,
  value,
  onChange,
  state = 'ready',
  sample = false,
  emptyMessage = 'No lists or segments yet. Connect Klaviyo to see them here.',
  maxHeight = 260
}: {
  label: string
  name: string
  options: readonly AudienceOption[]
  value: readonly string[]
  onChange: (next: string[]) => void
  state?: PickerState
  /** The options are sample data from the fake provider. */
  sample?: boolean
  emptyMessage?: string
  maxHeight?: number
}) {
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const saved = unique(value)
  const known = useMemo(() => new Set(options.map((o) => o.id)), [options])
  const ready = state === 'ready'
  const selected = ready ? saved.filter((v) => known.has(v)) : saved
  const missing = ready ? saved.length - selected.length : 0
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options
  }, [options, query])
  const toggle = (optionId: string, checked: boolean) =>
    onChange(
      checked
        ? unique([...selected, optionId])
        : selected.filter((v) => v !== optionId)
    )
  const status = !ready
    ? ''
    : query.trim() && shown.length === 0
      ? `No lists or segments match “${query.trim()}”.`
      : query.trim()
        ? `${shown.length} shown.`
        : ''
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{label}</legend>
      <div className="flex items-center gap-3">
        <p className="tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase">
          <span aria-hidden>{label}</span>
          <span className="ml-2 text-[var(--text)]" aria-live="polite">
            {selected.length} selected
          </span>
          {sample && (
            <span className="ml-2 font-sans normal-case">(sample lists)</span>
          )}
        </p>
        {ready && selected.length > 0 && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={() => {
              onChange([])
              search.current?.focus()
            }}
            className="ml-auto text-sm text-[var(--text-muted)] underline-offset-4 hover:text-[var(--text)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden"
          >
            Clear
          </button>
        )}
      </div>
      {missing > 0 && (
        <p className="mt-2 rounded-[var(--radius-small)] bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning-ink)]">
          {missing === 1
            ? '1 saved list or segment is no longer in Klaviyo. It will be removed when you save.'
            : `${missing} saved lists or segments are no longer in Klaviyo. They will be removed when you save.`}
        </p>
      )}
      <PickerSearch
        inputRef={search}
        label={`Search lists and segments for ${label}`}
        placeholder="Search lists & segments..."
        value={query}
        onChange={setQuery}
      />
      <div
        className="mt-2 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--line)]"
        style={{ maxHeight }}
      >
        {state === 'loading' ? (
          <p className="p-4 text-sm text-[var(--text-muted)]">
            Loading lists and segments… Your saved choice is kept.
          </p>
        ) : state === 'error' ? (
          <p className="p-4 text-sm text-[var(--danger-ink)]">
            Couldn&apos;t load lists and segments. Your saved choice is kept;
            try again later.
          </p>
        ) : options.length === 0 ? (
          <p className="p-4 text-sm text-[var(--text-muted)]">{emptyMessage}</p>
        ) : shown.length === 0 ? (
          <p className="p-4 text-sm text-[var(--text-muted)]">
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
                        className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-full border border-[var(--line-strong)] bg-[var(--surface-raised)] checked:border-[var(--brand-primary)] checked:bg-[var(--brand-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-1 focus-visible:outline-hidden forced-colors:appearance-auto"
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
      <PickerStatus text={status} />
      {selected.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
    </fieldset>
  )
}
