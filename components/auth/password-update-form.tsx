'use client'

import { useActionState } from 'react'
import { Button } from '@/components/gros/button'
import { Field } from '@/components/gros/input'
import { initialAuthActionState } from '@/features/auth/domain/types'
import { updatePassword } from '@/features/auth/presentation/actions'
import { AuthFeedback } from './auth-feedback'

/** Set a new password from a reset link (UI-AUTH): two fields, one button. */
export function PasswordUpdateForm() {
  const [state, action, pending] = useActionState(
    updatePassword,
    initialAuthActionState
  )
  return (
    <form
      action={action}
      aria-busy={pending}
      className="flex w-full flex-col items-start gap-[var(--space-5)]"
    >
      <div className="flex w-full flex-col gap-[var(--space-4)]">
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          error={state.fieldErrors?.password?.[0]}
        />
        <Field
          label="Confirm password"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          error={state.fieldErrors?.confirmation?.[0]}
        />
      </div>
      <Button
        type="submit"
        label="Update password"
        size="focus"
        disabled={pending}
      />
      <AuthFeedback state={state} />
    </form>
  )
}
