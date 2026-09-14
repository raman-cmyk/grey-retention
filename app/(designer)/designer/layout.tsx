import { AppShell } from '@/components/shell/app-shell'
import { designerNavigation } from '@/components/shell/nav-data'
import { requireRequestContext } from '@/features/auth/application/request-context'

export default async function DesignerLayout({
  children
}: {
  children: React.ReactNode
}) {
  await requireRequestContext('designer')
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
