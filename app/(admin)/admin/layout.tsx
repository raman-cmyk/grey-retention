import { AppShell } from '@/components/shell/app-shell'
import { adminNavigation } from '@/components/shell/nav-data'
import { requireRequestContext } from '@/features/auth/application/request-context'

export default async function AdminLayout({
  children
}: {
  children: React.ReactNode
}) {
  await requireRequestContext('admin')
  return (
    <AppShell
      navigation={adminNavigation}
      workspace="Platform operations"
      contextLabel="Admin console"
    >
      {children}
    </AppShell>
  )
}
