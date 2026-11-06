'use client'

import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type SegmentedOption<Value extends string> = {
  value: Value
  label: string
  /** Shown under the control when this option is selected. */
  description?: ReactNode
  /** Unavailable options stay visible with a reason instead of being faked. */
  disabledReason?: string
}

/**
 * Joined segments with mono uppercase labels (docs/DESIGN.md → Segmented
 * toggle). It is a native radio group, so arrow keys move between options,
 * screen readers announce "radio, 1 of 3", and the value submits with forms.
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
  const firstEnabled = options.find((option) => !option.disabledReason)
  const [internal, setInternal] = useState<Value | undefined>(
    defaultValue ?? firstEnabled?.value
  )
  const selected = value ?? internal
  const current = options.find((option) => option.value === selected)
  const describedBy = current?.description ? `${id}-description` : undefined

  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend
        className={cn(
          'tracking-label mb-2 font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase',
          hideLegend && 'sr-only'
        )}
      >
        {legend}
      </legend>
      <div className="inline-flex max-w-full flex-wrap overflow-hidden rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface-raised)]">
        {options.map((option, index) => {
          const disabled = Boolean(option.disabledReason)
          const optionId = `${id}-${index}`
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              title={option.disabledReason}
              className={cn(
                'tracking-label relative flex min-h-10 cursor-pointer items-center px-3.5 font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase transition-colors select-none has-[:focus-visible]:z-10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--focus)] has-[:focus-visible]:ring-inset',
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
                checked={selected === option.value}
                disabled={disabled}
                aria-describedby={disabled ? `${optionId}-reason` : describedBy}
                onChange={() => {
                  setInternal(option.value)
                  onValueChange?.(option.value)
                }}
                className="sr-only"
              />
              {option.label}
              {disabled && (
                <span id={`${optionId}-reason`} className="sr-only">
                  {`Not available: ${option.disabledReason}`}
                </span>
              )}
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
    </fieldset>
  )
}
