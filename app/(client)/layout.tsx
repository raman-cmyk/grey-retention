import { AppShell } from '@/components/shell/app-shell'
import { createClientNavigation } from '@/components/shell/nav-data'
import { defaultBrandPresentation } from '@/lib/branding/presentation'

export default function ClientLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <AppShell
      navigation={createClientNavigation(
        defaultBrandPresentation.assistantName
      )}
      brand={defaultBrandPresentation}
    >
      {children}
    </AppShell>
  )
}
