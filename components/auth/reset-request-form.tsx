'use client'

import { useActionState } from 'react'
import { initialAuthActionState } from '@/features/auth/domain/types'
import { requestPasswordReset } from '@/features/auth/presentation/actions'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { AuthFeedback } from './auth-feedback'

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    initialAuthActionState
  )
  return (
    <form action={action} className="mt-9 space-y-5">
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-[var(--text)]">
          Email
        </span>
        <TextField name="email" type="email" autoComplete="email" required />
        {state.fieldErrors?.email && (
          <span className="mt-2 block text-sm text-[var(--danger-ink)]">
            {state.fieldErrors.email[0]}
          </span>
        )}
      </label>
      <Button className="w-full" type="submit" disabled={pending}>
        {pending ? 'Requesting…' : 'Request reset link'}
      </Button>
      <AuthFeedback state={state} />
    </form>
  )
}
