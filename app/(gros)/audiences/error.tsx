'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** Audiences could not open: what happened, what to do, one button. */
export default function AudiencesError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="audiences" title="Audiences">
      <ErrorState
        title="Audiences did not open"
        reason="We could not read your Klaviyo segments and lists just now. Nothing was changed."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
