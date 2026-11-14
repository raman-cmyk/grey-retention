import { SignupForm } from '@/components/auth/signup-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Create your account' }

export default function SignupPage() {
  return (
    <div>
      <h1 className="tracking-display font-[family-name:var(--font-display)] text-4xl leading-none font-normal">
        Create workspace.
      </h1>
      <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
        Create your account. Workspace provisioning follows confirmation.
      </p>
      <SignupForm />
    </div>
  )
}
