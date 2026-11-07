'use client'

import { useMemo, useState } from 'react'
import { PickerSearch, PickerStatus, type PickerState } from './picker-parts'

export type ProductOption = {
  id: string
  title: string
  vendor?: string | null
}

/**
 * Product radio picker (docs/UI_REBUILD_SPEC.md §2): a search box over a
 * bordered ~300px scroll box. The first option, in muted italics, lets the
 * AI choose; each product reads `“Name” (vendor)`. The radios submit `name`
 * themselves; the saved product is still submitted while a search hides it
 * or while products load or fail, and a vanished product is named.
 */
export function ProductPicker({
  label,
  name,
  options,
  value,
  onChange,
  state = 'ready',
  sample = false,
  noneLabel = '— no default (let AI pick) —',
  emptyMessage = 'No products yet. Reading products from Klaviyo is not ready yet. For now, add them under Brand & Store.',
  maxHeight = 300
}: {
  label: string
  name: string
  options: readonly ProductOption[]
  /** Selected product id, or null for "let AI pick". */
  value: string | null
  onChange: (next: string | null) => void
  state?: PickerState
  sample?: boolean
  noneLabel?: string
  emptyMessage?: string
  maxHeight?: number
}) {
  const [query, setQuery] = useState('')
  const ready = state === 'ready'
  const known = options.some((o) => o.id === value)
  const chosen = ready ? (known ? value : null) : value
  const vanished = ready && value !== null && !known
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) =>
      `${o.title} ${o.vendor ?? ''}`.toLowerCase().includes(q)
    )
  }, [options, query])
  const hiddenChoice =
    ready && chosen !== null && !shown.some((option) => option.id === chosen)
  const row =
    'flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--surface-hover)]'
  const status =
    ready && query.trim()
      ? shown.length
        ? `${shown.length} shown.`
        : `No products match “${query.trim()}”.`
      : ''
  return (
    <fieldset className="min-w-0">
      <legend className="tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase">
        {label}
        {sample && (
          <span className="ml-2 font-sans normal-case">(sample products)</span>
        )}
      </legend>
      {vanished && (
        <p className="mt-2 rounded-[var(--radius-small)] bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning-ink)]">
          Your saved product is no longer in the store. The AI will pick one
          unless you choose another.
        </p>
      )}
      <PickerSearch
        label={`Search products for ${label}`}
        placeholder="Search products…"
        value={query}
        onChange={setQuery}
      />
      <div
        className="mt-2 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--line)]"
        style={{ maxHeight }}
      >
        {!ready ? (
          <p
            className={
              state === 'error'
                ? 'p-4 text-sm text-[var(--danger-ink)]'
                : 'p-4 text-sm text-[var(--text-muted)]'
            }
          >
            {state === 'error'
              ? "Couldn't load products. Your saved choice is kept; try again later."
              : 'Loading products… Your saved choice is kept.'}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-[var(--line)]">
              <li>
                <label className={row}>
                  <input
                    type="radio"
                    name={name}
                    value=""
                    checked={chosen === null}
                    onChange={() => onChange(null)}
                    className="shrink-0"
                  />
                  <span className="text-[var(--text-muted)] italic">
                    {noneLabel}
                  </span>
                </label>
              </li>
              {shown.map((option) => (
                <li key={option.id}>
                  <label className={row}>
                    <input
                      type="radio"
                      name={name}
                      value={option.id}
                      checked={chosen === option.id}
                      onChange={() => onChange(option.id)}
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 break-words">
                      “{option.title}”{option.vendor && ' '}
                      {option.vendor && (
                        <span className="text-[var(--text-muted)]">
                          ({option.vendor})
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {options.length === 0 ? (
              <p className="border-t border-[var(--line)] p-4 text-sm text-[var(--text-muted)]">
                {emptyMessage}
              </p>
            ) : (
              shown.length === 0 && (
                <p className="border-t border-[var(--line)] p-4 text-sm text-[var(--text-muted)]">
                  No products match “{query.trim()}”.
                </p>
              )
            )}
          </>
        )}
      </div>
      {hiddenChoice && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Chosen: “{options.find((o) => o.id === chosen)?.title}” (hidden by the
          search)
        </p>
      )}
      <PickerStatus text={status} />
      {(hiddenChoice || !ready) && (
        <input type="hidden" name={name} value={chosen ?? ''} />
      )}
    </fieldset>
  )
}
