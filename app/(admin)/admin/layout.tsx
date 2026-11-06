import { AppShell } from '@/components/shell/app-shell'
import { adminNavigation } from '@/components/shell/nav-data'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { shellIdentity } from '@/features/auth/presentation/shell-identity'

export default async function AdminLayout({
  children
}: {
  children: React.ReactNode
}) {
  const context = await requireRequestContext('admin')
  return (
    <AppShell
      navigation={adminNavigation}
      workspace="Platform operations"
      contextLabel="Admin console"
      identity={await shellIdentity(context)}
    >
      {children}
    </AppShell>
  )
}
