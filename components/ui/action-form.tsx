'use client'
import { useActionState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from './button'
import { cn } from '@/lib/utils'
export type FormResult = { error?: string; message?: string }
export type FormAction = (
  state: FormResult,
  form: FormData
) => Promise<FormResult>
export function ActionForm({
  action,
  children,
  className,
  preserveValues = false
}: {
  action: FormAction
  children: ReactNode
  className?: string
  preserveValues?: boolean
}) {
  const [state, dispatch, pending] = useActionState(action, {})
  return (
    <form
      action={dispatch}
      className={className}
      aria-busy={pending}
      onReset={preserveValues ? (event) => event.preventDefault() : undefined}
    >
      {children}
      <p
        aria-live="polite"
        className={cn(
          'text-sm empty:hidden',
          !pending &&
            (state.error || state.message) &&
            'mt-3 rounded-lg px-3 py-2',
          state.error
            ? 'bg-[var(--danger-soft)] text-[var(--danger-ink)]'
            : 'bg-[var(--brand-soft)] text-[var(--brand-ink)]'
        )}
      >
        {pending ? '' : (state.error ?? state.message)}
      </p>
    </form>
  )
}
export function SubmitButton({
  children,
  variant = 'primary'
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet'
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} variant={variant}>
      {pending ? 'Saving…' : children}
    </Button>
  )
}
