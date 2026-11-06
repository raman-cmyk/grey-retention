import { Pill, StatusPill } from '@/components/ui/pill'
import { campaignStatusOf, type StatusInput } from './status'

/** The one campaign status (UIR-015), or "Replaced" for history entries. */
export function CampaignPill({
  campaign,
  now
}: {
  campaign: StatusInput
  now?: Date
}) {
  const status = campaignStatusOf(campaign, now)
  return status ? (
    <StatusPill status={status} />
  ) : (
    <Pill title="A newer plan replaced this entry.">Replaced</Pill>
  )
}
