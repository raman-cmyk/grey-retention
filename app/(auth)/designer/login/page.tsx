import { SignInPanel } from '@/components/auth/sign-in-panel'
import { safeNext } from '@/features/auth/domain/next'

export default async function DesignerLoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const { next } = await searchParams
  return (
    <SignInPanel
      title="Your proofs are ready."
      description="Review assigned campaign context, submit design work, and respond to feedback."
      surface="designer"
      next={safeNext('designer', next)}
      resetHref="/forgot-password"
    />
  )
}
