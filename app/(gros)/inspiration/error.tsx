'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** Inspiration could not open: what happened, what to do, one button. */
export default function InspirationError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="inspiration" title="Inspiration">
      <ErrorState
        title="Inspiration did not open"
        reason="We could not read the brands you follow just now. Nothing was changed."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
