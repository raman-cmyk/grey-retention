import type { Database } from '@/lib/supabase/database.types'

type Row = Database['public']['Tables']['campaigns']['Row']

export type ReadinessInput = Pick<
  Row,
  | 'calendar_state'
  | 'copy_state'
  | 'design_state'
  | 'delivery_state'
  | 'planned_at'
  | 'audience_id'
  | 'calendar_revision'
  | 'copy_revision'
  | 'design_revision'
  | 'superseded_by_plan'
>

export type ApprovalStep = {
  key: 'date' | 'copy' | 'design' | 'audience' | 'time'
  label: string
  done: boolean
  /** What is true now, or what has to happen next. */
  detail: string
  /** Where on the campaign page that step is done. */
  href: '#review-status' | '#brief' | '#copy' | '#design-review'
}

/** Delivery has it (in flight, scheduled, unconfirmed, or sent). */
const handedOver = new Set([
  'queued',
  'preparing',
  'prepared',
  'scheduling',
  'scheduled',
  'reconciling',
  'sent'
])

/**
 * Delivery already has it: nothing left to approve. Cancelled, failed and
 * blocked sends are not "started": the owner can make a new package.
 */
export function deliveryStarted(c: Pick<Row, 'delivery_state'>) {
  return handedOver.has(c.delivery_state)
}

/**
 * The approve-then-schedule checklist (docs/OWNER_JOURNEYS.md Job 4,
 * §18.4, UIR-016). Every step is a real record that the database checks
 * again when the owner packages and schedules; this only says it in plain
 * words. `owner` changes orders ("Approve copy version 3") into waiting
 * ("Waiting for the owner to approve copy version 3").
 */
export function approvalSteps(
  c: ReadinessInput,
  now = new Date(),
  owner = true
): ApprovalStep[] {
  const planned = Date.parse(c.planned_at)
  const future = Number.isFinite(planned) && planned > now.getTime()
  const started = deliveryStarted(c)
  const ask = (todo: string) =>
    owner
      ? todo
      : `Waiting for the owner to ${todo[0].toLowerCase()}${todo.slice(1)}`
  return [
    {
      key: 'date',
      label: 'Date',
      done: c.calendar_state === 'approved',
      detail:
        c.calendar_state === 'approved'
          ? 'Approved'
          : c.calendar_state === 'rejected'
            ? `Turned down: ${owner ? 'pick a new date and approve it' : 'waiting for the owner to pick a new date'}`
            : ask(`Approve the date (version ${c.calendar_revision})`),
      href: '#review-status'
    },
    {
      key: 'copy',
      label: 'Copy',
      done: c.copy_state === 'approved',
      detail:
        c.copy_state === 'approved'
          ? `Version ${c.copy_revision} approved`
          : c.copy_state === 'pending_approval'
            ? ask(`Approve copy version ${c.copy_revision}`)
            : 'Write the copy, then send it for approval',
      href: '#copy'
    },
    {
      key: 'design',
      label: 'Design',
      done: c.design_state === 'owner_approved',
      detail:
        c.design_state === 'owner_approved'
          ? `Version ${c.design_revision} approved`
          : c.design_state === 'submitted'
            ? ask(`Review design version ${c.design_revision}`)
            : c.design_state === 'unassigned'
              ? 'No design yet'
              : 'The design is being made',
      href: '#design-review'
    },
    {
      key: 'audience',
      label: 'Send to',
      done: Boolean(c.audience_id),
      detail: c.audience_id ? 'Chosen' : 'Choose who to send to',
      href: '#brief'
    },
    {
      key: 'time',
      label: 'Send time',
      // Once delivery has it, the time is no longer the owner's to fix.
      done: started || future,
      detail: started
        ? 'Handed to delivery'
        : future
          ? 'In the future'
          : 'The time has passed: pick a new date',
      href: '#brief'
    }
  ]
}

/** What still stands between the owner and Schedule, in plain words. */
export function scheduleBlockers(c: ReadinessInput, now = new Date()) {
  return approvalSteps(c, now)
    .filter((s) => !s.done)
    .map((s) => `${s.label}: ${s.detail}`)
}

/** The checklist's closing line, for every delivery state. */
export function readinessLine({
  campaign: c,
  owner,
  ready,
  hasCurrentPackage,
  standingPolicy
}: {
  campaign: Pick<Row, 'delivery_state' | 'superseded_by_plan'>
  owner: boolean
  ready: boolean
  hasCurrentPackage: boolean
  /** The owner's standing L1 delivery policy schedules ready packages. */
  standingPolicy: boolean
}): { text: string; next: '#schedule' | '#package' | null } {
  if (c.superseded_by_plan)
    return {
      text: 'Replaced by a newer plan. Nothing to approve here.',
      next: null
    }
  if (c.delivery_state === 'sent')
    return { text: 'Sent. Nothing more to approve.', next: null }
  if (deliveryStarted(c))
    return {
      text: 'Scheduling has started. Delivery shows its progress below.',
      next: null
    }
  if (!ready)
    return {
      text: 'Schedule stays off until every step above is done.',
      next: null
    }
  const again =
    c.delivery_state === 'cancelled'
      ? 'Cancelled. To send it again, make a new package below.'
      : c.delivery_state === 'failed' || c.delivery_state === 'blocked'
        ? 'Sending stopped. Check delivery below, then make a new package.'
        : null
  if (!owner)
    return {
      text: again
        ? `${again.split('.')[0]}. Waiting for the brand owner.`
        : 'Waiting for the brand owner to make the package and schedule it.',
      next: null
    }
  if (again) return { text: again, next: '#package' }
  if (!hasCurrentPackage)
    return {
      text: 'Next: make the delivery package below. It also checks stock, offers and weekly limits.',
      next: '#package'
    }
  return standingPolicy
    ? {
        text: 'Ready. Your standing delivery policy schedules this on its next run; you can also confirm below.',
        next: '#schedule'
      }
    : {
        text: 'Ready. Check the summary and confirm Schedule below.',
        next: '#schedule'
      }
}

/** The package's own time has passed: it can't be scheduled any more. */
export function packageTimePassed(scheduledAt: string, now = new Date()) {
  const at = Date.parse(scheduledAt)
  return !Number.isFinite(at) || at <= now.getTime()
}
