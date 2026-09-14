import { SignInPanel } from '@/components/auth/sign-in-panel'

export default function DesignerLoginPage() {
  return (
    <SignInPanel
      title="Your proofs are ready."
      description="Review assigned campaign context, submit design work, and respond to feedback."
      resetHref="/forgot-password"
    />
  )
}
