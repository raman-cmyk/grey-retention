import { SignInPanel } from '@/components/auth/sign-in-panel'
import { retiredDesignerRoute } from '@/features/designers/retired'

export default function DesignerLoginPage() {
  // Decision D3: designers no longer sign in.
  retiredDesignerRoute()
  return (
    <SignInPanel
      title="Your proofs are ready."
      description="Review assigned campaign context, submit design work, and respond to feedback."
      surface="designer"
      resetHref="/forgot-password"
    />
  )
}
