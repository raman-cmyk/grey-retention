import { SignInPanel } from '@/components/auth/sign-in-panel'
import { FocusShell } from '@/components/gros/steps'
import { safeNext } from '@/features/auth/domain/next'

/**
 * Retired by decision D3 (RET-001): the proxy answers /designer/login with
 * the Not found page and a 404 before this page could run. Kept so the
 * designer surface's sign-in redirect still names a page.
 */
export default async function DesignerLoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const { next } = await searchParams
  return (
    <FocusShell>
      <SignInPanel
        title="Designer sign in"
        surface="designer"
        next={safeNext('designer', next)}
        resetHref="/forgot-password"
      />
    </FocusShell>
  )
}
