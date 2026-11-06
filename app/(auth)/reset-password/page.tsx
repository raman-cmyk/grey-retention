import { PasswordUpdateForm } from '@/components/auth/password-update-form'

export default function ResetPasswordPage() {
  return (
    <div>
      <h1 className="tracking-display font-[family-name:var(--font-display)] text-4xl leading-none font-normal">
        Set new access.
      </h1>
      <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
        Choose a unique password with at least 12 characters.
      </p>
      <PasswordUpdateForm />
    </div>
  )
}
