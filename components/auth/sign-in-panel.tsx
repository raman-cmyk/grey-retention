'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import {
  initialAuthActionState,
  type AuthSurface
} from '@/features/auth/domain/types'
import { signIn } from '@/features/auth/presentation/actions'
import { AuthFeedback } from './auth-feedback'

export function SignInPanel({
  title,
  description,
  surface,
  resetHref = '/forgot-password'
}: {
  title: string
  description: string
  surface: AuthSurface
  resetHref?: Route
}) {
  const [state, formAction, pending] = useActionState(
    signIn.bind(null, surface),
    initialAuthActionState
  )
  return (
    <div>
      <h1 className="font-[family-name:var(--font-display)] text-4xl leading-none font-bold tracking-[-0.035em]">
        {title}
      </h1>
      <p className="mt-4 max-w-sm text-sm leading-6 text-white/62">
        {description}
      </p>
      <form action={formAction} className="mt-9 space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/78">
            Email
          </span>
          <TextField
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            aria-describedby={
              state.fieldErrors?.email ? 'email-error' : undefined
            }
          />
          {state.fieldErrors?.email && (
            <span
              id="email-error"
              className="mt-2 block text-sm text-[#ffb4aa]"
            >
              {state.fieldErrors.email[0]}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/78">
            Password
          </span>
          <TextField
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Enter password"
            aria-describedby={
              state.fieldErrors?.password ? 'password-error' : undefined
            }
          />
          {state.fieldErrors?.password && (
            <span
              id="password-error"
              className="mt-2 block text-sm text-[#ffb4aa]"
            >
              {state.fieldErrors.password[0]}
            </span>
          )}
        </label>
        <Button className="w-full" type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <AuthFeedback state={state} />
      <Link
        className="mt-5 inline-block text-sm text-white/65 underline hover:text-white"
        href={resetHref}
      >
        Forgot password?
      </Link>
    </div>
  )
}
