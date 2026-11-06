import { describe, expect, it } from 'vitest'
import {
  approvalSteps,
  deliveryStarted,
  scheduleBlockers,
  type ReadinessInput
} from './schedule-readiness'

const now = new Date('2026-11-06T12:00:00Z')
const ready: ReadinessInput = {
  calendar_state: 'approved',
  copy_state: 'approved',
  design_state: 'owner_approved',
  delivery_state: 'ready',
  planned_at: '2026-11-20T09:00:00Z',
  audience_id: 'aud-1',
  calendar_revision: 2,
  copy_revision: 3,
  design_revision: 4
}

describe('approve, then schedule', () => {
  it('is ready only when date, copy, design, audience and time are all set', () => {
    expect(scheduleBlockers(ready, now)).toEqual([])
    expect(approvalSteps(ready, now).map((s) => s.detail)).toEqual([
      'Approved',
      'Version 3 approved',
      'Version 4 approved',
      'Chosen',
      'In the future'
    ])
  })

  it('names each missing approval with its version and where to do it', () => {
    const steps = approvalSteps(
      {
        ...ready,
        calendar_state: 'proposed',
        copy_state: 'pending_approval',
        design_state: 'submitted'
      },
      now
    )
    expect(steps.filter((s) => !s.done).map((s) => [s.detail, s.href])).toEqual(
      [
        ['Approve the date (version 2)', '#brief'],
        ['Approve copy version 3', '#copy'],
        ['Review design version 4', '#design']
      ]
    )
  })

  it('blocks a past time and an empty audience', () => {
    expect(
      scheduleBlockers(
        { ...ready, planned_at: '2026-11-01T09:00:00Z', audience_id: null },
        now
      )
    ).toEqual([
      'Send to: Choose who to send to',
      'Send time: The time has passed: pick a new date'
    ])
    // Exactly now is not in the future.
    expect(
      scheduleBlockers({ ...ready, planned_at: now.toISOString() }, now)
    ).toHaveLength(1)
  })

  it('says what is happening when copy or design are not ready', () => {
    const detail = (over: Partial<ReadinessInput>) =>
      approvalSteps({ ...ready, ...over }, now)
        .filter((s) => !s.done)
        .map((s) => s.detail)
    expect(detail({ copy_state: 'draft' })).toEqual([
      'Write the copy, then approve it'
    ])
    expect(detail({ design_state: 'unassigned' })).toEqual(['No design yet'])
    expect(detail({ design_state: 'assigned' })).toEqual([
      'The design is being made'
    ])
    expect(detail({ calendar_state: 'rejected' })).toEqual([
      'Turned down: pick a new date and approve it'
    ])
  })

  it('knows when delivery already has it', () => {
    expect(deliveryStarted({ delivery_state: 'ready' })).toBe(false)
    expect(deliveryStarted({ delivery_state: 'not_ready' })).toBe(false)
    for (const state of ['queued', 'scheduled', 'sent', 'failed', 'cancelled'])
      expect(deliveryStarted({ delivery_state: state })).toBe(true)
  })
})
