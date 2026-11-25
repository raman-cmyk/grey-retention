'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** The Brand book could not open: what happened, what to do, one button. */
export default function BrandBookError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="brand" title="Brand book">
      <ErrorState
        title="Brand book did not open"
        reason="We could not read your Brand book just now. Nothing was changed."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
