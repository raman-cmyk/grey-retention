import { accountSteps, AuthTitle } from '@/components/auth/auth-feedback'
import { WorkspaceForm } from '@/components/auth/workspace-form'
import { FocusShell, StepCards } from '@/components/gros/steps'
import { PendingInvites } from '@/features/operations/invitations'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Set up your workspace' }

/**
 * Signed in with no workspace yet (UI-AUTH): accept an invitation waiting
 * for this email, or create the brand's own workspace, which opens /setup.
 */
export default function OnboardingPage() {
  return (
    <FocusShell panel={<StepCards steps={accountSteps} current={1} />}>
      <AuthTitle text="Your workspace" />
      <PendingInvites />
      <WorkspaceForm />
    </FocusShell>
  )
}
