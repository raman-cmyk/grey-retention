'use client'

import { Search } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { controlClass } from './control'

export type ProductOption = {
  id: string
  title: string
  vendor?: string | null
}

/**
 * Product radio picker (docs/UI_REBUILD_SPEC.md §2): a search box over a
 * bordered ~300px scroll box. The first option, in muted italics, lets the
 * AI choose; each product reads `“Name” (vendor)`. The chosen product stays
 * chosen (and submitted) even while a search hides it.
 */
export function ProductPicker({
  label,
  name,
  options,
  value,
  onChange,
  noneLabel = '— no default (let AI pick) —',
  maxHeight = 300
}: {
  label: string
  name: string
  options: readonly ProductOption[]
  /** Selected product id, or null for "let AI pick". */
  value: string | null
  onChange: (next: string | null) => void
  noneLabel?: string
  maxHeight?: number
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const chosen = options.some((o) => o.id === value) ? value : null
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) =>
      `${o.title} ${o.vendor ?? ''}`.toLowerCase().includes(q)
    )
  }, [options, query])
  const hiddenChoice =
    chosen !== null && !shown.some((option) => option.id === chosen)
  const row =
    'flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--surface-hover)]'
  return (
    <fieldset className="min-w-0">
      <legend className="tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase">
        {label}
      </legend>
      <div className="relative mt-2">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
        />
        <input
          type="search"
          aria-label={`Search products for ${label}`}
          placeholder="Search products…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={`${controlClass} w-full pl-9`}
        />
      </div>
      <div
        className="mt-2 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--line)]"
        style={{ maxHeight }}
      >
        <ul className="divide-y divide-[var(--line)]">
          <li>
            <label className={row}>
              <input
                type="radio"
                name={`${id}-choice`}
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
                  name={`${id}-choice`}
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
            No products yet. Connect Shopify to choose one.
          </p>
        ) : (
          shown.length === 0 && (
            <p
              role="status"
              className="border-t border-[var(--line)] p-4 text-sm text-[var(--text-muted)]"
            >
              No products match “{query.trim()}”.
            </p>
          )
        )}
      </div>
      {hiddenChoice && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Chosen: “{options.find((o) => o.id === chosen)?.title}” (hidden by the
          search)
        </p>
      )}
      <input type="hidden" name={name} value={chosen ?? ''} />
    </fieldset>
  )
}
