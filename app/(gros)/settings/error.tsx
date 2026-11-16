'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** Settings could not open: what happened, what to do, one button. */
export default function SettingsError({ reset }: { reset: () => void }) {
  return (
    <AppPage current="settings" title="Settings">
      <ErrorState
        title="Settings did not open"
        reason="We could not read your workspace just now. Your offers, codes and Klaviyo key are safe."
        action={<Button label="Try again" onClick={reset} />}
      />
    </AppPage>
  )
}
