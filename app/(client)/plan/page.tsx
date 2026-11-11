import type { Metadata } from 'next'
import { Notice, PageHeading } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { latestPlanRun } from '@/features/strategy/load'
import { PlanView } from '@/features/strategy/view'

export const metadata: Metadata = { title: 'Plan next 15 days' }

export default async function PlanPage() {
  const context = await requireRequestContext('client')
  const run = await latestPlanRun(context.tenantId)
  return (
    <div className="mx-auto max-w-[820px]">
      <PageHeading
        title="Plan next 15 days"
        description="Your emails for the next 15 days, each with its reason. Start a plan whenever you like."
      />
      {run.ok ? (
        <PlanView run={run.run} owner={context.tenantRole === 'owner'} />
      ) : (
        <Notice error>We could not load your plan. Reload the page.</Notice>
      )}
    </div>
  )
}
