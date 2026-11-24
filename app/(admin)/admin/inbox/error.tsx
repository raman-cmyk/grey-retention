'use client'

import { AdminPage } from '@/components/gros/admin-nav'
import { Button } from '@/components/gros/button'
import { ErrorState } from '@/components/gros/states'

/** The inbox page could not open: what happened, what to do, one button. */
export default function InboxError({ retry }: { retry: () => void }) {
  return (
    <AdminPage current="inbox" title="Inspiration inbox">
      <ErrorState
        title="The inbox did not open"
        reason="We could not read the inbox just now. Its emails and brands are safe. Try again."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AdminPage>
  )
}
