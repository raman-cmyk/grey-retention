'use client'

import { KlaviyoError } from '@/features/klaviyo-detail/page-states'

/** A Klaviyo campaign's page could not open: what happened, what to do, one button. */
export default function CampaignError({ retry }: { retry: () => void }) {
  return (
    <KlaviyoError
      title="Campaign"
      what="This campaign did not open"
      retry={retry}
    />
  )
}
