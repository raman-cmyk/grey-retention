'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** "Add your own email" could not open: what happened, what to do, one button. */
export default function AddOwnEmailError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="inspiration" title="Add your own email">
      <ErrorState
        title="This page did not open"
        reason="We could not read your emails just now. Nothing was saved."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
