import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { ErrorState } from '@/components/gros/states'
import { ButtonLink } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { latestPlanRun } from '@/features/strategy/load'
import { planScreen } from '@/features/strategy/plan-screen'
import { PlanScreen } from '@/features/strategy/screen'

export const metadata: Metadata = { title: 'Plan' }
// The "Create email" click builds the email after its reply (REL-AI part 2).
export const maxDuration = 120

/** Plan (UI-PLAN-b): the next 15 days on the GROS components. */
export default async function PlanPage() {
  const context = await requireRequestContext('client')
  const run = await latestPlanRun(context.tenantId, context.timezone)
  if (!run.ok)
    return (
      <AppPage current="plan" title="Plan">
        <ErrorState
          title="The plan did not open"
          reason="We could not read your plan just now. Your emails are safe."
          action={<ButtonLink href="/plan" label="Try again" />}
        />
      </AppPage>
    )
  return (
    <PlanScreen
      view={planScreen(run.run, { owner: context.tenantRole === 'owner' })}
    />
  )
}
