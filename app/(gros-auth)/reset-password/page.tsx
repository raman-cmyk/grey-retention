import { AuthTitle } from '@/components/auth/auth-feedback'
import { PasswordUpdateForm } from '@/components/auth/password-update-form'
import { FocusShell } from '@/components/gros/steps'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Set a new password' }

/** Set a new password from a reset link (UI-AUTH). */
export default function ResetPasswordPage() {
  return (
    <FocusShell>
      <AuthTitle text="Set new password" />
      <PasswordUpdateForm />
    </FocusShell>
  )
}
