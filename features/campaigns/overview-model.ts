import type { Database } from '@/lib/supabase/database.types'

export type OverviewCampaign = Database['public']['Tables']['campaigns']['Row']

export function campaignReview(c: OverviewCampaign) {
  if (
    c.superseded_by_plan ||
    ['sent', 'cancelled', 'scheduled'].includes(c.delivery_state)
  )
    return null
  if (c.calendar_state === 'proposed') return 'Calendar review'
  if (c.design_state === 'submitted') return 'Design review'
  if (c.copy_state === 'pending_approval') return 'Copy review'
  return null
}

export function campaignNextStep(c: OverviewCampaign) {
  if (c.superseded_by_plan) return 'Historical draft'
  if (c.delivery_state === 'sent') return 'View results'
  if (c.delivery_state === 'cancelled') return 'Cancelled'
  if (['failed', 'blocked', 'reconciling'].includes(c.delivery_state))
    return 'Check delivery'
  if (c.delivery_state === 'scheduled') return 'Scheduled'
  const review = campaignReview(c)
  if (review) return review
  if (c.calendar_state === 'rejected') return 'Revise calendar'
  if (c.copy_state !== 'approved') return 'Prepare copy'
  if (c.design_state === 'revisions_requested') return 'Revise design'
  if (c.design_state !== 'owner_approved') return 'Design in progress'
  return 'Prepare delivery'
}

export function overviewModel(campaigns: OverviewCampaign[]) {
  const current = campaigns.filter((c) => !c.superseded_by_plan)
  const active = current.filter(
    (c) => !['sent', 'cancelled'].includes(c.delivery_state)
  )
  const reviews = active.filter((c) => campaignReview(c))
  const scheduled = active.filter((c) => c.delivery_state === 'scheduled')
  const inProduction = active.filter(
    (c) => !campaignReview(c) && c.delivery_state !== 'scheduled'
  )
  return { current, active, reviews, scheduled, inProduction }
}
