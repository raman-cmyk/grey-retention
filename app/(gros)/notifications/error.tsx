'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** Notifications could not open: what happened, what to do, one button. */
export default function NotificationsError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="notices" title="Notifications">
      <ErrorState
        title="Notifications did not open"
        reason="We could not read them just now. Nothing is lost: try again in a minute."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
