'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** Brand could not open: what happened, what to do, one button. */
export default function BrandError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="brand" title="Brand">
      <ErrorState
        title="Brand did not open"
        reason="We could not read your brand just now. Your brand details and approvals are safe."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
