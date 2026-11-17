'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** Plan could not open: what happened, what to do, one button. */
export default function PlanError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="plan" title="Plan">
      <ErrorState
        title="The plan did not open"
        reason="We could not read your plan just now. Your emails are safe."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
