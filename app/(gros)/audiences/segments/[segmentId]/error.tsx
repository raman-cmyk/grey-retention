'use client'

import { Button, ButtonLink } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'

/** A segment's page could not open: what happened, what to do, one button. */
export default function SegmentError({ retry }: { retry: () => void }) {
  return (
    <AppPage current="audiences" title="Segment">
      <div>
        <ButtonLink href="/audiences" label="Back to Audiences" kind="quiet" />
      </div>
      <ErrorState
        title="This segment did not open"
        reason="We could not read it from Klaviyo just now. Nothing was changed."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}
