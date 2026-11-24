import type { Metadata } from 'next'
import { AdminPage } from '@/components/gros/admin-nav'
import { adminAlsoMember } from '@/features/auth/application/admin-member'
import {
  LiveSwitchesPanel,
  OperatorPanel,
  RetirementWatchPanel,
  SupportPanel
} from '@/features/operations/panels'
import { FallbackLogPanel } from '@/features/fallback/panel'

export const metadata: Metadata = { title: 'Operations' }

/**
 * Operations (UI-ADM): the go-live switches first, then the fallback log,
 * the model retirement watch, workspaces, jobs, provider health, fixture
 * packages and the support queue, as GROS cards.
 */
export default async function Page() {
  return (
    <AdminPage
      current="operations"
      title="Operations"
      member={await adminAlsoMember()}
    >
      <LiveSwitchesPanel />
      <FallbackLogPanel />
      <RetirementWatchPanel />
      <OperatorPanel />
      <SupportPanel />
    </AdminPage>
  )
}
