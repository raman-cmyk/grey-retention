import { AppShell } from '@/components/shell/app-shell'
import { createClientNavigation } from '@/components/shell/nav-data'
import { defaultBrandPresentation } from '@/lib/branding/presentation'
import { requireRequestContext } from '@/features/auth/application/request-context'

export default async function ClientLayout({
  children
}: {
  children: React.ReactNode
}) {
  const context = await requireRequestContext('client')
  return (
    <AppShell
      navigation={createClientNavigation(
        defaultBrandPresentation.assistantName
      )}
      brand={defaultBrandPresentation}
      workspace={context.tenantName}
    >
      {children}
    </AppShell>
  )
}
