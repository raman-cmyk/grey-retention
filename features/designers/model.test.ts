import { describe, expect, it } from 'vitest'
import {
  assignmentStatus,
  canSubmit,
  closedReason,
  deskModel,
  dueLine,
  parseDeskFilter,
  reviewWords
} from './model'

const now = new Date('2026-11-07T12:00:00Z')
const hours = (n: number) =>
  new Date(now.getTime() + n * 3600_000).toISOString()

function assignment(
  id: string,
  state: string,
  due: string,
  brief: unknown = { title: `Brief ${id}`, brandName: 'Cedar Lane' }
) {
  return { id, state, due_at: due, copy_revision: 2, brief }
}

describe('assignmentStatus', () => {
  it('names each state from the designer side', () => {
    expect(assignmentStatus('assigned').label).toBe('To do')
    expect(assignmentStatus('revisions_requested').label).toBe('Redo requested')
    expect(assignmentStatus('submitted').label).toBe('Waiting for owner')
    expect(assignmentStatus('approved').label).toBe('Approved')
    expect(assignmentStatus('cancelled').group).toBeNull()
  })

  it('says the brief changed when the approved copy moved on', () => {
    expect(assignmentStatus('assigned', true).label).toBe('Brief changed')
    expect(assignmentStatus('revisions_requested', true).label).toBe(
      'Brief changed'
    )
    // A submitted or approved version stays as it was.
    expect(assignmentStatus('submitted', true).label).toBe('Waiting for owner')
  })

  it('never reads an unknown state as done', () => {
    const s = assignmentStatus('archived')
    expect(s.label).toBe('Unknown')
    expect(s.group).toBeNull()
  })
})

describe('canSubmit and closedReason', () => {
  it('opens submitting only on the designer turn with a current brief', () => {
    expect(canSubmit('assigned', false)).toBe(true)
    expect(canSubmit('revisions_requested', false)).toBe(true)
    expect(canSubmit('assigned', true)).toBe(false)
    expect(canSubmit('submitted', false)).toBe(false)
    expect(canSubmit('approved', false)).toBe(false)
    expect(closedReason('assigned', false)).toBeNull()
  })

  it('explains why the form is closed', () => {
    expect(closedReason('submitted', false)).toMatch(/owner is reviewing/)
    expect(closedReason('approved', false)).toMatch(/approved/)
    expect(closedReason('cancelled', false)).toMatch(/taken off your desk/)
    expect(closedReason('assigned', true)).toMatch(/current brief/)
  })
})

describe('dueLine', () => {
  it('warns close to the due time and flags overdue work', () => {
    expect(dueLine(hours(30), 'assigned', now)).toMatchObject({
      text: 'Due in 1 day',
      tone: 'neutral'
    })
    expect(dueLine(hours(3), 'assigned', now)).toMatchObject({
      text: 'Due in 3 hours',
      tone: 'warning'
    })
    expect(dueLine(hours(-2), 'revisions_requested', now)).toMatchObject({
      text: 'Was due 2 hours ago',
      tone: 'danger'
    })
  })

  it('shows the exact UTC time, without urgency once submitted', () => {
    const line = dueLine('2026-11-07T09:30:00Z', 'submitted', now)
    expect(line).toEqual({
      text: 'Due Nov 7, 2026 · 9:30 AM UTC',
      tone: 'neutral',
      exact: 'Nov 7, 2026 · 9:30 AM UTC'
    })
  })

  it('returns null for a broken date', () => {
    expect(dueLine('not a date', 'assigned', now)).toBeNull()
  })
})

describe('deskModel', () => {
  const list = [
    assignment('a', 'submitted', hours(5)),
    assignment('b', 'assigned', hours(20)),
    assignment('c', 'revisions_requested', hours(-1)),
    assignment('d', 'approved', hours(-50)),
    assignment('e', 'approved', hours(-10)),
    assignment('f', 'cancelled', hours(1))
  ]

  it('counts each tab and leaves cancelled briefs out', () => {
    expect(deskModel(list, null, now).counts).toEqual({
      todo: 2,
      waiting: 1,
      approved: 2,
      all: 5
    })
  })

  it('opens on To do when there is work, otherwise on All', () => {
    expect(deskModel(list, null, now).filter).toBe('todo')
    expect(
      deskModel([assignment('a', 'submitted', hours(5))], null, now).filter
    ).toBe('all')
    expect(deskModel(list, 'approved', now).filter).toBe('approved')
  })

  it('puts overdue work first, then waiting, then newest approved', () => {
    expect(deskModel(list, null, now).rows.map((r) => r.id)).toEqual(['c', 'b'])
    expect(deskModel(list, 'all', now).rows.map((r) => r.id)).toEqual([
      'c',
      'b',
      'a',
      'e',
      'd'
    ])
  })

  it('falls back to plain words when the brief has no title', () => {
    const [row] = deskModel(
      [assignment('x', 'assigned', hours(4), { title: ' ' })],
      null,
      now
    ).rows
    expect(row.title).toBe('Approved campaign brief')
    expect(row.brand).toBeNull()
  })
})

describe('parseDeskFilter and reviewWords', () => {
  it('accepts only known tabs', () => {
    expect(parseDeskFilter('waiting')).toBe('waiting')
    expect(parseDeskFilter(['approved', 'todo'])).toBe('approved')
    expect(parseDeskFilter('drafts')).toBeNull()
    expect(parseDeskFilter(undefined)).toBeNull()
  })

  it('names owner decisions', () => {
    expect(reviewWords('approved').label).toBe('Approved')
    expect(reviewWords('revision').label).toBe('Redo requested')
  })
})
