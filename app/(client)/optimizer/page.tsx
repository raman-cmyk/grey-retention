import { PageHeading } from '@/components/ui/workspace'
import { OptimizerPanel } from '@/features/optimizer/panel'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Bill Optimizer' }
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
