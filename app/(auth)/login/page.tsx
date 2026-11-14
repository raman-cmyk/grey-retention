import { SignInPanel } from '@/components/auth/sign-in-panel'
import { safeNext } from '@/features/auth/domain/next'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Sign in' }

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
