import { SignInPanel } from '@/components/auth/sign-in-panel'
import { safeNext } from '@/features/auth/domain/next'

export default async function ClientLoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const { next } = await searchParams
  return (
    <SignInPanel
      title="Return to the work."
      description="Open your campaign calendar, current proofs, and retention evidence."
      surface="client"
      next={safeNext('client', next)}
    />
  )
}
