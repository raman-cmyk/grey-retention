import { KlaviyoLoading } from '@/features/klaviyo-detail/page-states'

/** One flow email's page is opening: the bar at once, the cards when read. */
export default function FlowEmailLoading() {
  return <KlaviyoLoading title="Flow email" words="Opening the email" />
}
