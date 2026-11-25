'use client'

import { KlaviyoError } from '@/features/klaviyo-detail/page-states'

/** A Klaviyo flow's page could not open: what happened, what to do, one button. */
export default function FlowError({ retry }: { retry: () => void }) {
  return (
    <KlaviyoError title="Flow" what="This flow did not open" retry={retry} />
  )
}
