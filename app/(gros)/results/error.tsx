'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** Results could not open: what happened, what to do, one button. */
export default function ResultsError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="results" title="Results">
      <ErrorState
        title="Results did not open"
        reason="We could not read your results just now. Your emails are safe in Klaviyo."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
