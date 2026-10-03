'use client'
import { useActionState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from './button'
export type FormResult = { error?: string; message?: string }
export type FormAction = (
  state: FormResult,
  form: FormData
) => Promise<FormResult>
export function ActionForm({
  action,
  children,
  className
}: {
  action: FormAction
  children: ReactNode
  className?: string
}) {
  const [state, dispatch] = useActionState(action, {})
  return (
    <form action={dispatch} className={className}>
      {children}
      <p aria-live="polite" className="mt-3 text-sm">
        {state.error ?? state.message}
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
