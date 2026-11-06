import { describe, expect, it } from 'vitest'
import {
  awaitingConfirmation,
  campaignStatusOf,
  stepStateWords,
  type StatusInput
} from './status'

const now = new Date('2026-11-06T12:00:00Z')
const past = '2026-11-01T09:00:00Z'
const base: StatusInput = {
  channel: 'email_design',
  calendar_state: 'approved',
  copy_state: 'draft',
  design_state: 'unassigned',
  delivery_state: 'not_ready',
  planned_at: '2026-11-20T09:00:00Z',
  superseded_by_plan: null
}
/** Everything approved, as it is when delivery takes over. */
const approved: Partial<StatusInput> = {
  copy_state: 'approved',
  design_state: 'owner_approved'
}
const status = (over: Partial<StatusInput>) =>
  campaignStatusOf({ ...base, ...over }, now)

describe('one campaign status', () => {
  it('starts as Draft', () => {
    expect(status({})).toBe('draft')
    // A design email with approved copy but no design yet is still a draft.
    expect(status({ copy_state: 'approved' })).toBe('draft')
    expect(status({ copy_state: 'rejected' })).toBe('draft')
  })

  it('needs the owner for the date, copy, design, and the final yes', () => {
    expect(status({ calendar_state: 'proposed' })).toBe('needs_approval')
    expect(status({ copy_state: 'pending_approval' })).toBe('needs_approval')
    expect(status({ design_state: 'submitted' })).toBe('needs_approval')
    expect(status(approved)).toBe('needs_approval')
    expect(status({ ...approved, delivery_state: 'ready' })).toBe(
      'needs_approval'
    )
  })

  it('makes text emails pass their design review too', () => {
    const text = { channel: 'email_text' }
    expect(status({ ...text, copy_state: 'approved' })).toBe('draft')
    expect(
      status({ ...text, copy_state: 'approved', design_state: 'submitted' })
    ).toBe('needs_approval')
    expect(status({ ...text, ...approved })).toBe('needs_approval')
  })

  it('is With designer while a designer works on it', () => {
    expect(status({ design_state: 'assigned' })).toBe('with_designer')
    expect(status({ design_state: 'revisions_requested' })).toBe(
      'with_designer'
    )
    // Text emails never go to a designer: their revisions are the owner's.
    expect(
      status({ channel: 'email_text', design_state: 'revisions_requested' })
    ).toBe('draft')
  })

  it('shows a moved date before the designer work', () => {
    expect(
      status({ calendar_state: 'proposed', design_state: 'assigned' })
    ).toBe('needs_approval')
  })

  it('treats a turned-down date as a Draft to revise, not Cancelled', () => {
    expect(status({ calendar_state: 'rejected' })).toBe('draft')
    // Nothing to approve and schedule until the date is approved again.
    expect(status({ ...approved, calendar_state: 'rejected' })).toBe('draft')
  })

  it('is Scheduled only when confirmed, or on its way for a future time', () => {
    expect(status({ ...approved, delivery_state: 'scheduled' })).toBe(
      'scheduled'
    )
    for (const state of ['queued', 'preparing', 'prepared', 'scheduling']) {
      expect(status({ ...approved, delivery_state: state })).toBe('scheduled')
      expect(awaitingConfirmation({ delivery_state: state })).toBe(true)
    }
    expect(awaitingConfirmation({ delivery_state: 'scheduled' })).toBe(false)
  })

  it('is Sent and Cancelled only from delivery', () => {
    expect(status({ ...approved, delivery_state: 'sent' })).toBe('sent')
    expect(status({ ...approved, delivery_state: 'cancelled' })).toBe(
      'cancelled'
    )
  })

  it('calls failed, blocked and unconfirmed deliveries a Delivery problem', () => {
    for (const delivery_state of ['failed', 'blocked', 'reconciling']) {
      expect(status({ ...approved, delivery_state })).toBe('delivery_problem')
      // Even after the time passed: the owner must check what happened.
      expect(status({ ...approved, delivery_state, planned_at: past })).toBe(
        'delivery_problem'
      )
    }
  })

  it('is Missed when its time passed without a confirmed schedule', () => {
    expect(status({ planned_at: past })).toBe('missed')
    expect(status({ planned_at: now.toISOString() })).toBe('missed')
    expect(status({ planned_at: past, design_state: 'assigned' })).toBe(
      'missed'
    )
    expect(
      status({ ...approved, delivery_state: 'ready', planned_at: past })
    ).toBe('missed')
    // The worker refuses past times, so an in-flight send will not go out.
    for (const state of ['queued', 'preparing', 'prepared', 'scheduling'])
      expect(
        status({ ...approved, delivery_state: state, planned_at: past })
      ).toBe('missed')
    // Confirmed scheduled or sent wins over the clock.
    expect(
      status({ ...approved, delivery_state: 'scheduled', planned_at: past })
    ).toBe('scheduled')
    expect(
      status({ ...approved, delivery_state: 'sent', planned_at: past })
    ).toBe('sent')
  })

  it('hides entries replaced by a newer plan', () => {
    expect(status({ superseded_by_plan: 'plan-2' })).toBeNull()
  })

  it('names every step state in plain words', () => {
    expect(stepStateWords('copy', 'pending_approval')).toBe(
      'Waiting for your approval'
    )
    expect(stepStateWords('design', 'owner_approved')).toBe('Approved')
    expect(stepStateWords('delivery', 'reconciling')).toBe(
      'Not confirmed — check it'
    )
    expect(stepStateWords('delivery', 'mystery')).toBe('Unknown')
    for (const state of [
      'not_ready',
      'ready',
      'queued',
      'preparing',
      'prepared',
      'scheduling',
      'scheduled',
      'sent',
      'reconciling',
      'blocked',
      'cancelled',
      'failed'
    ])
      expect(stepStateWords('delivery', state)).not.toMatch(/_/)
  })
})
