'use client'

import { useActionState } from 'react'
import { Button } from '@/components/gros/button'
import { Field } from '@/components/gros/input'
import { initialAuthActionState } from '@/features/auth/domain/types'
import { requestPasswordReset } from '@/features/auth/presentation/actions'
import { AuthFeedback } from './auth-feedback'

/** Ask for a reset link (UI-AUTH): the account email and one button. */
export function ResetRequestForm() {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    initialAuthActionState
  )
  return (
    <form
      action={action}
      aria-busy={pending}
      className="flex w-full flex-col items-start gap-[var(--space-5)]"
    >
      <Field
        className="w-full"
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={state.fieldErrors?.email?.[0]}
      />
      <Button
        type="submit"
        label="Send reset link"
        size="focus"
        disabled={pending}
      />
      <AuthFeedback state={state} />
    </form>
  )
}
