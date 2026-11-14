import { PageHeading } from '@/components/ui/workspace'
import { SupportPanel } from '@/features/operations/panels'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Support' }
export default function Page() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title="Support"
        description="Persisted support and feedback threads scoped to your workspace."
      />
      <SupportPanel />
    </div>
  )
}
