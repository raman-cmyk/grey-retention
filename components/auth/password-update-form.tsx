'use client'

import { useActionState } from 'react'
import { initialAuthActionState } from '@/features/auth/domain/types'
import { updatePassword } from '@/features/auth/presentation/actions'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { AuthFeedback } from './auth-feedback'

export function PasswordUpdateForm() {
  const [state, action, pending] = useActionState(
    updatePassword,
    initialAuthActionState
  )
  return (
    <form action={action} className="mt-9 space-y-5">
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-white/78">
          New password
        </span>
        <TextField
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-white/78">
          Confirm password
        </span>
        <TextField
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </label>
      <Button className="w-full" type="submit" disabled={pending}>
        {pending ? 'Updating…' : 'Update password'}
      </Button>
      <AuthFeedback state={state} />
    </form>
  )
}
