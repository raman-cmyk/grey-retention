import { SignInPanel } from '@/components/auth/sign-in-panel'
import { FocusShell } from '@/components/gros/steps'
import { safeNext } from '@/features/auth/domain/next'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin sign in' }

/** Platform admins sign in here (UI-AUTH); the server checks the role. */
export default async function AdminLoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const { next } = await searchParams
  return (
    <FocusShell>
      <SignInPanel
        title="Admin sign in"
        surface="admin"
        next={safeNext('admin', next)}
        resetHref="/forgot-password"
      />
    </FocusShell>
  )
}
