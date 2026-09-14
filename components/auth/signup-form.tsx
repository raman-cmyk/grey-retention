'use client'

import { useActionState } from 'react'
import { initialAuthActionState } from '@/features/auth/domain/types'
import { signUp } from '@/features/auth/presentation/actions'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { AuthFeedback } from './auth-feedback'

export function SignupForm() {
  const [state, action, pending] = useActionState(
    signUp,
    initialAuthActionState
  )
  return (
    <form action={action} className="mt-9 grid gap-5 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="mb-2 block text-sm font-medium text-white/78">
          Name
        </span>
        <TextField name="name" autoComplete="name" required />
        {state.fieldErrors?.name && (
          <span className="mt-2 block text-sm text-[#ffb4aa]">
            {state.fieldErrors.name[0]}
          </span>
        )}
      </label>
      <label className="block sm:col-span-2">
        <span className="mb-2 block text-sm font-medium text-white/78">
          Work email
        </span>
        <TextField name="email" type="email" autoComplete="email" required />
        {state.fieldErrors?.email && (
          <span className="mt-2 block text-sm text-[#ffb4aa]">
            {state.fieldErrors.email[0]}
          </span>
        )}
      </label>
      <label className="block sm:col-span-2">
        <span className="mb-2 block text-sm font-medium text-white/78">
          Password
        </span>
        <TextField
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        {state.fieldErrors?.password && (
          <span className="mt-2 block text-sm text-[#ffb4aa]">
            {state.fieldErrors.password[0]}
          </span>
        )}
      </label>
      <Button className="sm:col-span-2" type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Continue'}
      </Button>
      <div className="sm:col-span-2">
        <AuthFeedback state={state} />
      </div>
    </form>
  )
}
