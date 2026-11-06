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
>

export type ApprovalStep = {
  key: 'date' | 'copy' | 'design' | 'audience' | 'time'
  label: string
  done: boolean
  /** What is true now, or what the owner must do next. */
  detail: string
  /** Where on the campaign page that step is done. */
  href: '#brief' | '#copy' | '#design'
}

/**
 * The owner's approve-then-schedule checklist (docs/OWNER_JOURNEYS.md Job 4,
 * §18.4, UIR-016). Every step is a real record checked again by the
 * database when the owner schedules; this only says it in plain words.
 */
export function approvalSteps(
  c: ReadinessInput,
  now = new Date()
): ApprovalStep[] {
  const planned = Date.parse(c.planned_at)
  const future = Number.isFinite(planned) && planned > now.getTime()
  return [
    {
      key: 'date',
      label: 'Date',
      done: c.calendar_state === 'approved',
      detail:
        c.calendar_state === 'approved'
          ? 'Approved'
          : c.calendar_state === 'rejected'
            ? 'Turned down: pick a new date and approve it'
            : `Approve the date (version ${c.calendar_revision})`,
      href: '#brief'
    },
    {
      key: 'copy',
      label: 'Copy',
      done: c.copy_state === 'approved',
      detail:
        c.copy_state === 'approved'
          ? `Version ${c.copy_revision} approved`
          : c.copy_state === 'pending_approval'
            ? `Approve copy version ${c.copy_revision}`
            : 'Write the copy, then approve it',
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
            ? `Review design version ${c.design_revision}`
            : c.design_state === 'unassigned'
              ? 'No design yet'
              : 'The design is being made',
      href: '#design'
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
      done: future,
      detail: future ? 'In the future' : 'The time has passed: pick a new date',
      href: '#brief'
    }
  ]
}

/** Delivery already has it: nothing left to approve. */
export function deliveryStarted(c: Pick<Row, 'delivery_state'>) {
  return !['not_ready', 'ready'].includes(c.delivery_state)
}

/** What still stands between the owner and Schedule, in plain words. */
export function scheduleBlockers(c: ReadinessInput, now = new Date()) {
  return approvalSteps(c, now)
    .filter((s) => !s.done)
    .map((s) => `${s.label}: ${s.detail}`)
}
