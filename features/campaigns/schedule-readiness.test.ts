import { describe, expect, it } from 'vitest'
import {
  approvalSteps,
  deliveryStarted,
  packageTimePassed,
  readinessLine,
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
  design_revision: 4,
  superseded_by_plan: null
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
        ['Approve the date (version 2)', '#review-status'],
        ['Approve copy version 3', '#copy'],
        ['Review design version 4', '#design-review']
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
      'Write the copy, then send it for approval'
    ])
    expect(detail({ design_state: 'unassigned' })).toEqual(['No design yet'])
    expect(detail({ design_state: 'assigned' })).toEqual([
      'The design is being made'
    ])
    expect(detail({ calendar_state: 'rejected' })).toEqual([
      'Turned down: pick a new date and approve it'
    ])
  })

  it('knows when delivery already has it, and when a new package is possible', () => {
    for (const state of [
      'ready',
      'not_ready',
      'cancelled',
      'failed',
      'blocked'
    ])
      expect(deliveryStarted({ delivery_state: state })).toBe(false)
    for (const state of ['queued', 'scheduled', 'reconciling', 'sent'])
      expect(deliveryStarted({ delivery_state: state })).toBe(true)
  })

  it('never asks to fix the time once delivery has the campaign', () => {
    const sent = {
      ...ready,
      delivery_state: 'sent',
      planned_at: '2026-11-01T09:00:00Z'
    }
    expect(scheduleBlockers(sent, now)).toEqual([])
    expect(approvalSteps(sent, now).at(-1)?.detail).toBe('Handed to delivery')
  })

  it('asks staff and admins to wait for the owner instead of giving orders', () => {
    const steps = approvalSteps(
      { ...ready, copy_state: 'pending_approval' },
      now,
      false
    )
    expect(steps.find((s) => s.key === 'copy')?.detail).toBe(
      'Waiting for the owner to approve copy version 3'
    )
  })

  it('closes with the right line for every delivery state', () => {
    const line = (
      over: Partial<ReadinessInput>,
      opts: Partial<Parameters<typeof readinessLine>[0]> = {}
    ) =>
      readinessLine({
        campaign: { ...ready, ...over },
        owner: true,
        ready: true,
        hasCurrentPackage: true,
        standingPolicy: false,
        ...opts
      })
    expect(line({})).toEqual({
      text: 'Ready. Check the summary and confirm Schedule below.',
      next: '#schedule'
    })
    expect(line({}, { hasCurrentPackage: false }).next).toBe('#package')
    expect(line({ delivery_state: 'sent' })).toEqual({
      text: 'Sent. Nothing more to approve.',
      next: null
    })
    expect(line({ delivery_state: 'scheduled' }).next).toBeNull()
    expect(line({ delivery_state: 'cancelled' })).toEqual({
      text: 'Cancelled. To send it again, make a new package below.',
      next: '#package'
    })
    expect(line({ delivery_state: 'failed' }).text).toMatch(/^Sending stopped/)
    expect(line({ delivery_state: 'cancelled' }, { owner: false })).toEqual({
      text: 'Cancelled. Waiting for the brand owner.',
      next: null
    })
    expect(line({ superseded_by_plan: 'p2' })).toEqual({
      text: 'Replaced by a newer plan. Nothing to approve here.',
      next: null
    })
    expect(line({}, { standingPolicy: true }).text).toMatch(
      /standing delivery policy schedules this/
    )
    expect(line({}, { ready: false }).next).toBeNull()
  })

  it('knows when a package time has passed', () => {
    expect(packageTimePassed('2026-11-01T09:00:00Z', now)).toBe(true)
    expect(packageTimePassed(now.toISOString(), now)).toBe(true)
    expect(packageTimePassed('2026-11-20T09:00:00Z', now)).toBe(false)
    expect(packageTimePassed('junk', now)).toBe(true)
  })
})
