'use client'

import { useActionState, useId, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { useHydrated } from '@/components/ui/use-hydrated'
import { cn } from '@/lib/utils'
import { buttonClasses, type ButtonKind, type ButtonSize } from './button'

/**
 * A GROS button that runs a server action (Plan next 15 days, Create email).
 * It keeps its words while working (BRAND.md: the page shows the progress),
 * cannot be pressed twice or before the page's JavaScript runs (a native
 * post would lose the action's answer), and says under itself what went
 * wrong (or what was done), in the action's own plain words. With
 * `children` (GROS `Field`s) it is a small form: the fields sit above it.
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
  children,
  keep = false,
  confirm
}: {
  action: ServerAction
  /** The button's words, kept while the action runs. */
  label: string
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
  const [state, dispatch, pending] = useActionState(action, {})
  const answerId = useId()
  // The last answer, hidden while a new one is on its way.
  const answer = pending ? null : (state.error ?? state.message ?? null)
  return (
    <form
      action={dispatch}
      aria-busy={pending}
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
        kind={kind}
        size={size}
        describedBy={answer ? answerId : undefined}
      />
      <p
        id={answerId}
        aria-live="polite"
        className={cn(
          'type-caption empty:hidden',
          state.error ? 'text-[var(--signal-ink)]' : 'text-[var(--ink)]'
        )}
      >
        {answer ?? ''}
      </p>
    </form>
  )
}

function Submit({
  label,
  kind,
  size,
  describedBy
}: {
  label: string
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
      aria-describedby={describedBy}
      className={buttonClasses(kind, size)}
    >
      {label}
    </button>
  )
}
