import { KlaviyoLoading } from '@/features/klaviyo-detail/page-states'

/** A Klaviyo campaign's page is opening: the bar at once, the cards when read. */
export default function CampaignLoading() {
  return <KlaviyoLoading title="Campaign" words="Opening the campaign" />
}
