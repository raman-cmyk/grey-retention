'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** "Use this design" could not open: what happened, what to do, one button. */
export default function UseDesignError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="inspiration" title="Use this design">
      <ErrorState
        title="This page did not open"
        reason="We could not read your emails just now. Nothing was saved."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
