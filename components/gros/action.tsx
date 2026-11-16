'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { buttonClasses, type ButtonKind, type ButtonSize } from './button'

/**
 * A GROS button that runs a server action (Plan next 15 days, Create email).
 * It keeps its words while working (the page shows the progress), cannot
 * be pressed twice, and says what went wrong under itself, in the action's
 * own plain words.
 */
export type ActionResult = { error?: string; message?: string }
export type ServerAction = (
  state: ActionResult,
  form: FormData
) => Promise<ActionResult>

export function ActionButton({
  action,
  label,
  pendingLabel,
  kind = 'main',
  size = 'app',
  fields = {}
}: {
  action: ServerAction
  label: string
  /** What the button says while the action runs: Starting… */
  pendingLabel: string
  kind?: Exclude<ButtonKind, 'round'>
  size?: ButtonSize
  /** Hidden values the action reads (a run and a slot). */
  fields?: Record<string, string>
}) {
  const [state, dispatch] = useActionState(action, {})
  return (
    <form
      action={dispatch}
      className="flex flex-col items-start gap-[var(--space-2)]"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Submit
        label={label}
        pendingLabel={pendingLabel}
        kind={kind}
        size={size}
      />
      <p
        aria-live="polite"
        className="type-caption text-[var(--signal-ink)] empty:hidden"
      >
        {state.error ?? ''}
      </p>
    </form>
  )
}

function Submit({
  label,
  pendingLabel,
  kind,
  size
}: {
  label: string
  pendingLabel: string
  kind: Exclude<ButtonKind, 'round'>
  size: ButtonSize
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={buttonClasses(kind, size)}
    >
      {pending ? pendingLabel : label}
    </button>
  )
}
