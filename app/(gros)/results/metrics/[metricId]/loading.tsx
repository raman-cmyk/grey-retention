import { KlaviyoLoading } from '@/features/klaviyo-detail/page-states'

/** A Klaviyo metric's page is opening: the bar at once, the cards when read. */
export default function MetricLoading() {
  return <KlaviyoLoading title="Metric" words="Opening the metric" />
}
