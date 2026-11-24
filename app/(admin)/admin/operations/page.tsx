import { PageHeading } from '@/components/ui/workspace'
import {
  LiveSwitchesPanel,
  OperatorPanel,
  RetirementWatchPanel
} from '@/features/operations/panels'
import { FallbackLogPanel } from '@/features/fallback/panel'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Operations' }
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeading
        title="Operations"
        description="The go-live switches, the fallback log, sanitized jobs, provider health, immutable fixture packages and tenant support."
      />
      <LiveSwitchesPanel />
      <FallbackLogPanel />
      <RetirementWatchPanel />
      <OperatorPanel />
    </div>
  )
}
