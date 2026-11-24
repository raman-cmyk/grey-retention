'use client'

import { AdminPage } from '@/components/gros/admin-nav'
import { Button } from '@/components/gros/button'
import { ErrorState } from '@/components/gros/states'

/** Operations could not open: what happened, what to do, one button. */
export default function OperationsError({ retry }: { retry: () => void }) {
  return (
    <AdminPage current="operations" title="Operations">
      <ErrorState
        title="Operations did not open"
        reason="We could not read the switches and jobs just now. Nothing was changed. Try again."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AdminPage>
  )
}
