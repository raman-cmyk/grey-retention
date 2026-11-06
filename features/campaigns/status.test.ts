import { describe, expect, it } from 'vitest'
import {
  campaignStatusOf,
  hasDeliveryProblem,
  type StatusInput
} from './status'

const now = new Date('2026-11-06T12:00:00Z')
const base: StatusInput = {
  channel: 'email_design',
  calendar_state: 'approved',
  copy_state: 'draft',
  design_state: 'unassigned',
  delivery_state: 'not_ready',
  planned_at: '2026-11-20T09:00:00Z',
  superseded_by_plan: null
}
const status = (over: Partial<StatusInput>) =>
  campaignStatusOf({ ...base, ...over }, now)

describe('one campaign status', () => {
  it('starts as Draft', () => {
    expect(status({})).toBe('draft')
  })

  it('needs the owner for the calendar entry, copy, design, and the final yes', () => {
    expect(status({ calendar_state: 'proposed' })).toBe('needs_approval')
    expect(status({ copy_state: 'pending_approval' })).toBe('needs_approval')
    expect(status({ design_state: 'submitted' })).toBe('needs_approval')
    expect(
      status({ copy_state: 'approved', design_state: 'owner_approved' })
    ).toBe('needs_approval')
    expect(status({ channel: 'email_text', copy_state: 'approved' })).toBe(
      'needs_approval'
    )
    // A design email with approved copy but no design yet is still a draft.
    expect(status({ copy_state: 'approved' })).toBe('draft')
  })

  it('is With designer while a designer works on it', () => {
    expect(status({ design_state: 'assigned' })).toBe('with_designer')
    expect(status({ design_state: 'revisions_requested' })).toBe(
      'with_designer'
    )
  })

  it('is Scheduled once delivery has it, and Sent only when confirmed', () => {
    for (const state of [
      'queued',
      'preparing',
      'prepared',
      'scheduling',
      'scheduled',
      'reconciling'
    ])
      expect(status({ delivery_state: state })).toBe('scheduled')
    expect(status({ delivery_state: 'sent' })).toBe('sent')
  })

  it('is Cancelled when stopped or when the owner rejected the calendar entry', () => {
    expect(status({ delivery_state: 'cancelled' })).toBe('cancelled')
    expect(status({ calendar_state: 'rejected' })).toBe('cancelled')
  })

  it('is Missed when its time passed before it was scheduled', () => {
    expect(status({ planned_at: '2026-11-01T09:00:00Z' })).toBe('missed')
    expect(
      status({ planned_at: '2026-11-01T09:00:00Z', design_state: 'assigned' })
    ).toBe('missed')
    // Already scheduled or sent wins over the clock.
    expect(
      status({
        planned_at: '2026-11-01T09:00:00Z',
        delivery_state: 'scheduled'
      })
    ).toBe('scheduled')
    expect(
      status({ planned_at: '2026-11-01T09:00:00Z', delivery_state: 'sent' })
    ).toBe('sent')
  })

  it('hides entries replaced by a newer plan, and flags delivery problems', () => {
    expect(status({ superseded_by_plan: 'plan-2' })).toBeNull()
    expect(status({ delivery_state: 'failed' })).toBe('draft')
    expect(hasDeliveryProblem({ delivery_state: 'failed' })).toBe(true)
    expect(hasDeliveryProblem({ delivery_state: 'blocked' })).toBe(true)
    expect(hasDeliveryProblem({ delivery_state: 'scheduled' })).toBe(false)
  })
})
