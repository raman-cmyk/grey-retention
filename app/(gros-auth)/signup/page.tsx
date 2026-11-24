import { accountSteps, AuthTitle } from '@/components/auth/auth-feedback'
import { SignupForm } from '@/components/auth/signup-form'
import { FocusShell, StepCards } from '@/components/gros/steps'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Create your account' }

/** Create an account (UI-AUTH): the first of the two steps in. */
export default function SignupPage() {
  return (
    <FocusShell panel={<StepCards steps={accountSteps} current={0} />}>
      <AuthTitle text="Create account" />
      <SignupForm />
    </FocusShell>
  )
}
