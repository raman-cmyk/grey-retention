import { AppShell } from '@/components/shell/app-shell'
import { designerNavigation } from '@/components/shell/nav-data'

export default function DesignerLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <AppShell
      navigation={designerNavigation}
      workspace="Design desk"
      contextLabel="Designer workspace"
    >
      {children}
    </AppShell>
  )
}
