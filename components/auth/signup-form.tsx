'use client'

import { useActionState } from 'react'
import { Button } from '@/components/gros/button'
import { Field } from '@/components/gros/input'
import { initialAuthActionState } from '@/features/auth/domain/types'
import { signUp } from '@/features/auth/presentation/actions'
import { AuthFeedback } from './auth-feedback'

/** Create an account (UI-AUTH): name, work email, password, one button. */
export function SignupForm() {
  const [state, action, pending] = useActionState(
    signUp,
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
          label="Name"
          name="name"
          autoComplete="name"
          required
          error={state.fieldErrors?.name?.[0]}
        />
        <Field
          label="Work email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={state.fieldErrors?.email?.[0]}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          error={state.fieldErrors?.password?.[0]}
        />
      </div>
      <Button
        type="submit"
        label="Create account"
        size="focus"
        disabled={pending}
      />
      <AuthFeedback state={state} />
    </form>
  )
}
