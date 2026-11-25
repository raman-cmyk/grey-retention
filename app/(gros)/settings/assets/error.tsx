'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** Brand assets could not open: what happened, what to do, one button. */
export default function AssetsError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="settings" title="Brand assets">
      <ErrorState
        title="Brand assets did not open"
        reason="We could not read your brand files just now. Your files are safe."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
