import { AppShell } from '@/components/shell/app-shell'
import { adminNavigation } from '@/components/shell/nav-data'

export default function AdminLayout({
  children
}: {
  children: React.ReactNode
}) {
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
