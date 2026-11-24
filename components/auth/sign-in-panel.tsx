'use client'

import type { Route } from 'next'
import { useActionState } from 'react'
import { Button, ButtonLink } from '@/components/gros/button'
import { Field } from '@/components/gros/input'
import {
  initialAuthActionState,
  type AuthSurface
} from '@/features/auth/domain/types'
import { signIn } from '@/features/auth/presentation/actions'
import { AuthFeedback, AuthTitle } from './auth-feedback'

/**
 * Sign in on the GROS focused shell (UI-AUTH): one title, the email and
 * password, one Sign in button that keeps its words while it works, the
 * answer under it, and the quiet way to reset a password. The surface
 * (client or admin) is fixed per page; the server checks it again.
 */
export function SignInPanel({
  title,
  surface,
  resetHref = '/forgot-password',
  next
}: {
  title: string
  surface: AuthSurface
  resetHref?: Route
  /** The page to go back to after signing in (checked again on the server). */
  next?: string | null
}) {
  const [state, formAction, pending] = useActionState(
    signIn.bind(null, surface),
    initialAuthActionState
  )
  return (
    <>
      <AuthTitle text={title} />
      <form
        action={formAction}
        aria-busy={pending}
        className="flex w-full flex-col items-start gap-[var(--space-5)]"
      >
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <div className="flex w-full flex-col gap-[var(--space-4)]">
          <Field
            label="Email"
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
            autoComplete="current-password"
            required
            error={state.fieldErrors?.password?.[0]}
          />
        </div>
        <Button type="submit" label="Sign in" size="focus" disabled={pending} />
        <AuthFeedback state={state} />
      </form>
      <div>
        <ButtonLink href={resetHref} label="Reset password" kind="quiet" />
      </div>
    </>
  )
}
