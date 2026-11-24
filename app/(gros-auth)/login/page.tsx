import { SignInPanel } from '@/components/auth/sign-in-panel'
import { FocusShell } from '@/components/gros/steps'
import { safeNext } from '@/features/auth/domain/next'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Sign in' }

/** Sign in to a store's workspace (UI-AUTH), on the GROS focused shell. */
export default async function ClientLoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const { next } = await searchParams
  return (
    <FocusShell>
      <SignInPanel
        title="Welcome back"
        surface="client"
        next={safeNext('client', next)}
      />
    </FocusShell>
  )
}
