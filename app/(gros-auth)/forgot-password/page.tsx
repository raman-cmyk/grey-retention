import { AuthTitle } from '@/components/auth/auth-feedback'
import { ResetRequestForm } from '@/components/auth/reset-request-form'
import { ButtonLink } from '@/components/gros/button'
import { FocusShell } from '@/components/gros/steps'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Forgot password' }

/** Ask for a reset link (UI-AUTH); the answer never says if the account exists. */
export default function ForgotPasswordPage() {
  return (
    <FocusShell>
      <AuthTitle text="Reset password" />
      <ResetRequestForm />
      <div>
        <ButtonLink href="/login" label="Back to sign in" kind="quiet" />
      </div>
    </FocusShell>
  )
}
