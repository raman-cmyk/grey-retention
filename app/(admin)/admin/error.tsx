'use client'

import { AdminPage } from '@/components/gros/admin-nav'
import { Button } from '@/components/gros/button'
import { ErrorState } from '@/components/gros/states'

/** An admin page could not open: what happened, what to do, one button. */
export default function AdminError({ retry }: { retry: () => void }) {
  return (
    <AdminPage title="Admin">
      <ErrorState
        title="This page did not open"
        reason="We could not read it just now. Nothing was changed. Try again."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AdminPage>
  )
}
