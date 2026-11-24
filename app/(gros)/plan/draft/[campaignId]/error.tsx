'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** A draft could not open: what happened, what to do, one button. */
export default function DraftPageError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="plan" title="Your draft">
      <ErrorState
        title="This draft did not open"
        reason="We could not read it just now. It is safe."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
