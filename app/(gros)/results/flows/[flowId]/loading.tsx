import { KlaviyoLoading } from '@/features/klaviyo-detail/page-states'

/** A Klaviyo flow's page is opening: the bar at once, the cards when read. */
export default function FlowLoading() {
  return <KlaviyoLoading title="Flow" words="Opening the flow" />
}
