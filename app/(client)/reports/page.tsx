import { PageHeading } from '@/components/ui/workspace'
import { ReportingPanel } from '@/features/reporting/panel'
export default function ReportsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Results & learning"
        description="Windowed synthetic metrics, evidence-linked preferences and guarded L2 simulations."
      />
      <ReportingPanel />
    </div>
  )
}
