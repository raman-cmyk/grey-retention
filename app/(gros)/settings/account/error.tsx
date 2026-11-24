'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** Account could not open: what happened, what to do, one button. */
export default function AccountError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="settings" title="Account">
      <ErrorState
        title="Account did not open"
        reason="We could not read your account just now. Your details are safe."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
