import { SignupForm } from '@/components/auth/signup-form'

export default function SignupPage() {
  return (
    <div>
      <h1 className="font-[family-name:var(--font-display)] text-4xl leading-none font-bold tracking-[-0.035em]">
        Create workspace.
      </h1>
      <p className="mt-4 text-sm leading-6 text-white/62">
        Create your account. Workspace provisioning follows confirmation.
      </p>
      <SignupForm />
    </div>
  )
}
