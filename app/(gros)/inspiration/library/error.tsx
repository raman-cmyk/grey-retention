'use client'

import { Button } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** The block library could not open: what happened, what to do, one button. */
export default function BlockLibraryError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="inspiration" title="Block library">
      <ErrorState
        title="This page did not open"
        reason="We could not read the block library just now. Nothing was changed."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
