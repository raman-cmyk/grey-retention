import { SignInPanel } from '@/components/auth/sign-in-panel'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Sign in' }

export default function ClientLoginPage() {
  return (
    <SignInPanel
      title="Return to the work."
      description="Open your campaign calendar, current proofs, and retention evidence."
      surface="client"
    />
  )
}
