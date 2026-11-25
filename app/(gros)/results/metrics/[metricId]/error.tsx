'use client'

import { KlaviyoError } from '@/features/klaviyo-detail/page-states'

/** A Klaviyo metric's page could not open: what happened, what to do, one button. */
export default function MetricError({ retry }: { retry: () => void }) {
  return (
    <KlaviyoError
      title="Metric"
      what="This metric did not open"
      retry={retry}
    />
  )
}
