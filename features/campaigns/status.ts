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

/** Delivery is setting it up; Klaviyo has not confirmed the time yet. */
const inFlight = new Set(['queued', 'preparing', 'prepared', 'scheduling'])
/** Delivery stopped, or its outcome is unknown (`reconciling`). */
const problems = new Set(['failed', 'blocked', 'reconciling'])

/**
 * The ONE status a campaign shows (docs/OWNER_JOURNEYS.md §18.3, UIR-015),
 * derived from the real state machine, never picked by hand. Checks, in
 * order:
 *
 * 1. Sent, Cancelled and Scheduled come only from delivery, and only once
 *    the provider confirmed them.
 * 2. A failed, blocked or unconfirmed (`reconciling`) delivery is a Delivery
 *    problem, whatever the clock says.
 * 3. An in-flight delivery (queued … scheduling) is Scheduled for a future
 *    time, and a Delivery problem once its time passed (the worker refuses
 *    past times, and the date can't be edited while delivery is active).
 * 4. Anything else whose time passed is Missed.
 * 5. Needs your approval: a moved or new calendar entry first, then copy
 *    or a made design waiting, then — copy AND design approved, for every
 *    channel (text emails get a text design the owner reviews) — the final
 *    approve-and-schedule step. A design being made or redone is Draft
 *    (decision D3 retired the human designer and "With designer").
 * 6. Everything else is Draft, including a rejected calendar entry (it can
 *    be revised and approved again; nothing else can be approved until
 *    then).
 *
 * Returns null for entries replaced by a newer plan (they are history).
 */
export function campaignStatusOf(
  c: StatusInput,
  now: Date = new Date()
): CampaignStatus | null {
  if (c.superseded_by_plan) return null
  if (c.delivery_state === 'sent') return 'sent'
  if (c.delivery_state === 'cancelled') return 'cancelled'
  if (c.delivery_state === 'scheduled') return 'scheduled'
  if (problems.has(c.delivery_state)) return 'delivery_problem'
  const planned = Date.parse(c.planned_at)
  const past = Number.isFinite(planned) && planned <= now.getTime()
  // Approved and being set up, but its time passed: the worker will refuse
  // it and the date cannot be edited while delivery is active.
  if (inFlight.has(c.delivery_state))
    return past ? 'delivery_problem' : 'scheduled'
  if (past) return 'missed'
  if (c.calendar_state === 'proposed') return 'needs_approval'
  // A turned-down date blocks the copy and design approvals too.
  if (c.calendar_state === 'rejected') return 'draft'
  if (c.copy_state === 'pending_approval' || c.design_state === 'submitted')
    return 'needs_approval'
  // The final approve-and-schedule step needs an approved date too.
  if (
    c.calendar_state === 'approved' &&
    c.copy_state === 'approved' &&
    c.design_state === 'owner_approved'
  )
    return 'needs_approval'
  return 'draft'
}

/** True while delivery is setting up a send Klaviyo has not confirmed. */
export function awaitingConfirmation(c: Pick<Row, 'delivery_state'>) {
  return inFlight.has(c.delivery_state)
}

type Step = 'calendar' | 'copy' | 'design' | 'delivery'

const stepWords: Record<Step, Record<string, string>> = {
  calendar: {
    proposed: 'Waiting for your approval',
    approved: 'Approved',
    rejected: 'Not approved'
  },
  copy: {
    draft: 'Being written',
    pending_approval: 'Waiting for your approval',
    approved: 'Approved',
    rejected: 'Changes asked'
  },
  design: {
    unassigned: 'Not started',
    // Only an old human assignment (retired by D3) sets this.
    assigned: 'Not started',
    submitted: 'Waiting for your approval',
    revisions_requested: 'Changes asked',
    owner_approved: 'Approved'
  },
  delivery: {
    not_ready: 'Not ready',
    ready: 'Ready to schedule',
    queued: 'Being scheduled',
    preparing: 'Being scheduled',
    prepared: 'Being scheduled',
    scheduling: 'Being scheduled',
    scheduled: 'Scheduled',
    sent: 'Sent',
    reconciling: 'Not confirmed — check it',
    blocked: 'Blocked',
    failed: 'Failed',
    cancelled: 'Cancelled'
  }
}

/** One step's state in plain words, for the campaign page (never raw). */
export function stepStateWords(step: Step, state: string) {
  return stepWords[step][state] ?? 'Unknown'
}
