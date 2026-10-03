import { PageHeading } from '@/components/ui/workspace'
import { OptimizerPanel } from '@/features/optimizer/panel'
export default function OptimizerPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Bill optimizer"
        description="Owner-approved local profile sweeps, purchaser protections and audited fixture reversal."
      />
      <OptimizerPanel />
    </div>
  )
}
