'use client'

import { KlaviyoError } from '@/features/klaviyo-detail/page-states'

/** One flow email's page could not open: what happened, what to do, one button. */
export default function FlowEmailError({ retry }: { retry: () => void }) {
  return (
    <KlaviyoError
      title="Flow email"
      what="This email did not open"
      retry={retry}
    />
  )
}
