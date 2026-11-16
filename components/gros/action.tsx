'use client'

import { useActionState, useId } from 'react'
import { useFormStatus } from 'react-dom'
import { useHydrated } from '@/components/ui/use-hydrated'
import { buttonClasses, type ButtonKind, type ButtonSize } from './button'

/**
 * A GROS button that runs a server action (Plan next 15 days, Create email).
 * It keeps its words while working (BRAND.md: the page shows the progress),
 * cannot be pressed twice or before the page's JavaScript runs (a native
 * post would lose the action's answer), and says what went wrong under
 * itself, in the action's own plain words.
 */
export type ActionResult = { error?: string; message?: string }
export type ServerAction = (
  state: ActionResult,
  form: FormData
) => Promise<ActionResult>

export function ActionButton({
  action,
  label,
  kind = 'main',
  size = 'app',
  fields = {},
  spokenLabel
}: {
  action: ServerAction
  /** The button's words, kept while the action runs. */
  label: string
  kind?: Exclude<ButtonKind, 'round'>
  size?: ButtonSize
  /** Hidden values the action reads (a run and a slot). */
  fields?: Record<string, string>
  /**
   * What a screen reader says when many buttons share a label: Pin: Lead
   * with one product. It always starts with the visible label.
   */
  spokenLabel?: string
}) {
  const [state, dispatch, pending] = useActionState(action, {})
  const errorId = useId()
  const error = pending ? null : (state.error ?? null)
  return (
    <form
      action={dispatch}
      aria-busy={pending}
      className="flex flex-col items-start gap-[var(--space-2)]"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Submit
        label={label}
        spoken={
          spokenLabel === undefined || spokenLabel.startsWith(label)
            ? spokenLabel
            : `${label}: ${spokenLabel}`
        }
        kind={kind}
        size={size}
        describedBy={error ? errorId : undefined}
      />
      <p
        id={errorId}
        aria-live="polite"
        className="type-caption text-[var(--signal-ink)] empty:hidden"
      >
        {error ?? ''}
      </p>
    </form>
  )
}

function Submit({
  label,
  spoken,
  kind,
  size,
  describedBy
}: {
  label: string
  spoken?: string
  kind: Exclude<ButtonKind, 'round'>
  size: ButtonSize
  describedBy?: string
}) {
  const { pending } = useFormStatus()
  const hydrated = useHydrated()
  return (
    <button
      type="submit"
      disabled={pending || !hydrated}
      aria-label={spoken}
      aria-describedby={describedBy}
      className={buttonClasses(kind, size)}
    >
      {label}
    </button>
  )
}
