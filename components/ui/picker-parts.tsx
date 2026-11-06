'use client'

import { Search } from 'lucide-react'
import type { KeyboardEvent, Ref } from 'react'
import { controlClass } from './control'

export type PickerState = 'ready' | 'loading' | 'error'

/** Search box shared by the pickers; Enter never submits the outer form. */
export function PickerSearch({
  label,
  placeholder,
  value,
  onChange,
  inputRef
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  inputRef?: Ref<HTMLInputElement>
}) {
  return (
    <div className="relative mt-2">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
      />
      <input
        ref={inputRef}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') event.preventDefault()
        }}
        className={`${controlClass} w-full pl-9`}
      />
    </div>
  )
}

/** Always-present live region, so screen readers hear every change. */
export function PickerStatus({ text }: { text: string }) {
  return (
    <p role="status" className="sr-only">
      {text}
    </p>
  )
}

export function unique(values: readonly string[]) {
  return [...new Set(values)]
}
