import { AppShell } from '@/components/shell/app-shell'
import { createClientNavigation } from '@/components/shell/nav-data'
import { defaultBrandPresentation } from '@/lib/branding/presentation'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { shellIdentity } from '@/features/auth/presentation/shell-identity'

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
      workspaceLabel="Store"
      workspace={context.tenantName}
      identity={await shellIdentity(context)}
    >
      {children}
    </AppShell>
  )
}
