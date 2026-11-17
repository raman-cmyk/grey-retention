'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** An email's page could not open: what happened, what to do, one button. */
export default function EmailError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="plan" title="Your email">
      <ErrorState
        title="This email did not open"
        reason="We could not read it just now. It is safe: try again in a moment."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
