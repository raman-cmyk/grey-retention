'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type SegmentedOption<Value extends string> = {
  value: Value
  label: string
  /** Shown under the control when this option is selected. */
  description?: ReactNode
  /** Unavailable options stay visible with a reason instead of being faked. */
  disabledReason?: string
}

function usable<Value extends string>(
  options: readonly SegmentedOption<Value>[],
  candidate: Value | undefined
) {
  const option = options.find((item) => item.value === candidate)
  return option && !option.disabledReason
    ? option.value
    : options.find((item) => !item.disabledReason)?.value
}

/**
 * Joined segments with mono uppercase labels (docs/DESIGN.md → Segmented
 * toggle). It is a native radio group, so arrow keys move between options,
 * screen readers announce "radio, 1 of 3", and the value submits with forms.
 * A disabled or unknown value falls back to the first available option, and
 * a form reset returns to `defaultValue`. If no option is available, nothing
 * is selected or submitted.
 */
export function SegmentedControl<Value extends string>({
  name,
  legend,
  options,
  defaultValue,
  value,
  onValueChange,
  hideLegend = false,
  className
}: {
  name: string
  legend: string
  options: readonly SegmentedOption<Value>[]
  defaultValue?: Value
  value?: Value
  onValueChange?: (value: Value) => void
  hideLegend?: boolean
  className?: string
}) {
  const id = useId()
  const fieldset = useRef<HTMLFieldSetElement>(null)
  const [internal, setInternal] = useState<Value | undefined>(() =>
    usable(options, defaultValue)
  )
  const selected = usable(options, value ?? internal)
  const current = options.find((option) => option.value === selected)
  const unavailable = options.filter((option) => option.disabledReason)

  useEffect(() => {
    const form = fieldset.current?.form
    if (!form) return
    const onReset = () => setInternal(usable(options, defaultValue))
    form.addEventListener('reset', onReset)
    return () => form.removeEventListener('reset', onReset)
  }, [options, defaultValue])

  return (
    <fieldset ref={fieldset} className={cn('min-w-0', className)}>
      <legend
        className={cn(
          'tracking-label mb-2 font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase',
          hideLegend && 'sr-only'
        )}
      >
        {legend}
      </legend>
      <div className="inline-flex max-w-full flex-wrap rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface-raised)]">
        {options.map((option, index) => {
          const disabled = Boolean(option.disabledReason)
          const optionId = `${id}-${index}`
          const isSelected = selected === option.value
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={cn(
                'tracking-label relative flex min-h-10 cursor-pointer items-center px-3.5 font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase transition-colors select-none first:rounded-l-[var(--radius-control)] last:rounded-r-[var(--radius-control)]',
                // Focus is a 2px ink outline inside the segment, distinct from
                // the 1px blue edge that marks the selected option.
                'has-[:focus-visible]:z-10 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-[var(--text)] has-[:focus-visible]:outline-solid',
                index > 0 && 'border-l border-[var(--line)]',
                !disabled &&
                  'hover:bg-[var(--surface-hover)] hover:text-[var(--text)]',
                'has-[:checked]:bg-[var(--brand-soft)] has-[:checked]:text-[var(--brand-secondary)] has-[:checked]:shadow-[inset_0_0_0_1px_var(--brand-secondary)]',
                disabled &&
                  'cursor-not-allowed text-[var(--text-faint)] opacity-60'
              )}
            >
              <input
                id={optionId}
                type="radio"
                name={name}
                value={option.value}
                checked={isSelected}
                disabled={disabled}
                aria-describedby={
                  disabled
                    ? `${optionId}-reason`
                    : isSelected && option.description
                      ? `${id}-description`
                      : undefined
                }
                onChange={() => {
                  setInternal(option.value)
                  onValueChange?.(option.value)
                }}
                className="sr-only"
              />
              {option.label}
            </label>
          )
        })}
      </div>
      {current?.description && (
        <p
          id={`${id}-description`}
          className="mt-2 text-sm leading-6 text-[var(--text-muted)]"
        >
          {current.description}
        </p>
      )}
      {unavailable.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs leading-5 text-[var(--text-muted)]">
          {unavailable.map((option) => (
            <li
              key={option.value}
              id={`${id}-${options.indexOf(option)}-reason`}
            >
              {`${option.label}: not available yet — ${option.disabledReason}`}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
