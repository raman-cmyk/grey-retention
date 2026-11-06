import { SignupForm } from '@/components/auth/signup-form'

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
