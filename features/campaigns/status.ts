import type { CampaignStatus } from '@/lib/campaign-status'
import type { Database } from '@/lib/supabase/database.types'

type Row = Database['public']['Tables']['campaigns']['Row']

export type StatusInput = Pick<
  Row,
  | 'channel'
  | 'calendar_state'
  | 'copy_state'
  | 'design_state'
  | 'delivery_state'
  | 'planned_at'
  | 'superseded_by_plan'
>

const onItsWay = new Set([
  'queued',
  'preparing',
  'prepared',
  'scheduling',
  'scheduled',
  'reconciling'
])

/**
 * The ONE status a campaign shows (docs/OWNER_JOURNEYS.md §18.3, UIR-015),
 * derived from the real state machine, never picked by hand:
 *
 * 1. Sent / Cancelled come from delivery; a rejected calendar entry is
 *    Cancelled too.
 * 2. Anything handed to delivery (queued … scheduled) is Scheduled.
 * 3. A campaign whose time passed without being scheduled is Missed.
 * 4. A designer at work (assigned, revisions requested) is With designer.
 * 5. Anything waiting for the owner is Needs your approval: the calendar
 *    entry, the copy, the delivered design, or — once copy (and design, for
 *    design emails) are approved — the final approve-and-schedule step.
 * 6. Everything else is Draft.
 *
 * Returns null for entries replaced by a newer plan (they are history).
 */
export function campaignStatusOf(
  c: StatusInput,
  now: Date = new Date()
): CampaignStatus | null {
  if (c.superseded_by_plan) return null
  if (c.delivery_state === 'sent') return 'sent'
  if (c.delivery_state === 'cancelled' || c.calendar_state === 'rejected')
    return 'cancelled'
  if (onItsWay.has(c.delivery_state)) return 'scheduled'
  const planned = Date.parse(c.planned_at)
  if (Number.isFinite(planned) && planned <= now.getTime()) return 'missed'
  if (['assigned', 'revisions_requested'].includes(c.design_state))
    return 'with_designer'
  if (
    c.calendar_state === 'proposed' ||
    c.copy_state === 'pending_approval' ||
    c.design_state === 'submitted'
  )
    return 'needs_approval'
  const designDone =
    c.channel === 'email_text' || c.design_state === 'owner_approved'
  if (c.copy_state === 'approved' && designDone) return 'needs_approval'
  return 'draft'
}

/** A delivery that stopped with an error; shown next to the status. */
export function hasDeliveryProblem(c: Pick<Row, 'delivery_state'>) {
  return c.delivery_state === 'failed' || c.delivery_state === 'blocked'
}
