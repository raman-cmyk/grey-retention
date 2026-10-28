import { PageHeading } from '@/components/ui/workspace'
import { OperatorPanel } from '@/features/operations/panels'
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Operations"
        description="Sanitized jobs, provider health, immutable fixture packages and tenant support."
      />
      <OperatorPanel />
    </div>
  )
}
