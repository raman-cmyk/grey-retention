import type { Database } from '@/lib/supabase/database.types'
import { awaitingConfirmation, campaignStatusOf } from './status'

export type OverviewCampaign = Database['public']['Tables']['campaigns']['Row']

/**
 * Which approval the owner owes, when the one status is "Needs your
 * approval" (UIR-015); otherwise null. The same list feeds the dashboard's
 * "Waiting for you" and the review queue.
 */
export function campaignReview(c: OverviewCampaign, now = new Date()) {
  if (campaignStatusOf(c, now) !== 'needs_approval') return null
  if (c.calendar_state === 'proposed') return 'Calendar review'
  if (c.design_state === 'submitted') return 'Design review'
  if (c.copy_state === 'pending_approval') return 'Copy review'
  return c.delivery_state === 'ready'
    ? 'Confirm the schedule'
    : 'Approve and schedule'
}

/**
 * What has to happen next, in a few words, agreeing with the status pill.
 * Null when nothing is pending (confirmed schedule, cancelled).
 */
export function campaignNextStep(
  c: OverviewCampaign,
  now = new Date()
): string | null {
  switch (campaignStatusOf(c, now)) {
    case null:
      return 'Historical draft'
    case 'sent':
      return 'View results'
    case 'cancelled':
      return null
    case 'scheduled':
      return awaitingConfirmation(c) ? 'Waiting for confirmation' : null
    case 'delivery_problem':
      return 'Check delivery'
    case 'missed':
      return 'Pick a new date'
    case 'needs_approval':
      return campaignReview(c, now)
    default:
      if (c.calendar_state === 'rejected') return 'Revise calendar'
      if (c.copy_state !== 'approved') return 'Prepare copy'
      if (c.design_state === 'revisions_requested') return 'Revise design'
      return 'Prepare design'
  }
}

/** The campaign list's buckets, all from the one status. */
export function overviewModel(campaigns: OverviewCampaign[], now = new Date()) {
  const current = campaigns.filter((c) => !c.superseded_by_plan)
  const status = (c: OverviewCampaign) => campaignStatusOf(c, now)
  const active = current.filter(
    (c) => !['sent', 'cancelled'].includes(status(c) ?? '')
  )
  const reviews = current.filter((c) => status(c) === 'needs_approval')
  const scheduled = current.filter((c) => status(c) === 'scheduled')
  const inProduction = current.filter((c) => status(c) === 'draft')
  const attention = current.filter((c) =>
    ['missed', 'delivery_problem'].includes(status(c) ?? '')
  )
  return { current, active, reviews, scheduled, inProduction, attention }
}
