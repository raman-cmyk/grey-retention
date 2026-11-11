import { PageHeading } from '@/components/ui/workspace'
import { OperatorPanel } from '@/features/operations/panels'
import { FallbackLogPanel } from '@/features/fallback/panel'
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeading
        title="Operations"
        description="The fallback log, sanitized jobs, provider health, immutable fixture packages and tenant support."
      />
      <FallbackLogPanel />
      <OperatorPanel />
    </div>
  )
}
