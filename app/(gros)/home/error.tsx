'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** Home could not open: what happened, what to do, one button. */
export default function HomeError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="home" title="Home">
      <ErrorState
        title="Home did not open"
        reason="We could not read your workspace just now. Your emails and plan are safe."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
