import Link from 'next/link'
import { ResetRequestForm } from '@/components/auth/reset-request-form'

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="tracking-display font-[family-name:var(--font-display)] text-4xl leading-none font-normal">
        Reset access.
      </h1>
      <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
        Enter your account email. We will send a time-limited reset link.
      </p>
      <ResetRequestForm />
      <Link
        className="mt-5 inline-block text-sm text-[var(--brand-secondary)] underline hover:text-[var(--brand-ink)]"
        href="/login"
      >
        Back to sign in
      </Link>
    </div>
  )
}
