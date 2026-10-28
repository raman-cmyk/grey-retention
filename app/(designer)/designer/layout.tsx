import { AppShell } from '@/components/shell/app-shell'
import { designerNavigation } from '@/components/shell/nav-data'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { shellIdentity } from '@/features/auth/presentation/shell-identity'

export default async function DesignerLayout({
  children
}: {
  children: React.ReactNode
}) {
  const context = await requireRequestContext('designer')
  return (
    <AppShell
      navigation={designerNavigation}
      workspace="Design desk"
      contextLabel="Designer workspace"
      identity={await shellIdentity(context)}
    >
      {children}
    </AppShell>
  )
}
