import { AppShell } from '@/components/shell/app-shell'
import { designerNavigation } from '@/components/shell/nav-data'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { shellIdentity } from '@/features/auth/presentation/shell-identity'
import { retiredDesignerRoute } from '@/features/designers/retired'

export default async function DesignerLayout({
  children
}: {
  children: React.ReactNode
}) {
  // Decision D3: the designer workspace is retired; every page is Not found.
  retiredDesignerRoute()
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
