import Link from 'next/link'
import { ResetRequestForm } from '@/components/auth/reset-request-form'

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="font-[family-name:var(--font-display)] text-4xl leading-none font-bold tracking-[-0.035em]">
        Reset access.
      </h1>
      <p className="mt-4 text-sm leading-6 text-white/62">
        Enter your account email. We will send a time-limited reset link.
      </p>
      <ResetRequestForm />
      <Link
        className="mt-5 inline-block text-sm text-white/65 underline hover:text-white"
        href="/login"
      >
        Back to sign in
      </Link>
    </div>
  )
}
