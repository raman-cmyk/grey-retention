'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** Learned could not open: what happened, what to do, one button. */
export default function LearnedError({ retry }: { retry: () => void }) {
  return (
    <AppPage title="Learned">
      <ErrorState
        title="Learned did not open"
        reason="We could not read your workspace just now. Its rules are safe."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
