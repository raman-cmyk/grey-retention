'use client'

import { useActionState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { cn } from '@/lib/utils'
import { buttonClasses, type ButtonKind, type ButtonSize } from './button'

/**
 * A GROS button that runs a server action (Plan next 15 days, Create email).
 * It keeps its words while working (the page shows the progress), cannot
 * be pressed twice, and says under itself what went wrong (or what was
 * done), in the action's own plain words. With `children` (GROS `Field`s)
 * it is a small form: the fields sit above the button.
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
  fields = {},
  children,
  keep = false,
  confirm
}: {
  action: ServerAction
  label: string
  /** What the button says while the action runs: Starting… */
  pendingLabel: string
  kind?: Exclude<ButtonKind, 'round'>
  size?: ButtonSize
  /** Hidden values the action reads (a run and a slot). */
  fields?: Record<string, string>
  /** Fields the person fills in, above the button. */
  children?: ReactNode
  /** Keep what was typed after an answer (else the fields clear, as React does). */
  keep?: boolean
  /** Asked first (Disconnect): No stops the action. */
  confirm?: string
}) {
  const [state, dispatch] = useActionState(action, {})
  return (
    <form
      action={dispatch}
      onReset={keep ? (event) => event.preventDefault() : undefined}
      onSubmit={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault()
            }
          : undefined
      }
      className={cn(
        'flex flex-col items-start',
        children ? 'gap-[var(--space-4)]' : 'gap-[var(--space-2)]'
      )}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children ? (
        <div className="flex w-full flex-col gap-[var(--space-4)]">
          {children}
        </div>
      ) : null}
      <Submit
        label={label}
        pendingLabel={pendingLabel}
        kind={kind}
        size={size}
      />
      <p
        aria-live="polite"
        className={cn(
          'type-caption empty:hidden',
          state.error ? 'text-[var(--signal-ink)]' : 'text-[var(--ink)]'
        )}
      >
        {state.error ?? state.message ?? ''}
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
