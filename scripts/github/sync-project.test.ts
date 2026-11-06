import { describe, expect, it } from 'vitest'
import {
  planIssueMilestoneOps,
  planLabelOps,
  planMilestoneOps
} from './sync-project.mjs'

const label = { name: 'priority:P0', color: 'b60205', description: 'First' }
const milestone = { key: 'M0', title: 'M0 Stabilize', description: 'Goal' }

describe('label sync plan', () => {
  it('creates missing labels and leaves matching ones alone', () => {
    expect(planLabelOps([], [label])).toEqual([{ kind: 'create-label', label }])
    expect(planLabelOps([{ ...label }], [label])).toEqual([])
  })

  it('fixes labels GitHub auto-created without colour or description', () => {
    expect(
      planLabelOps(
        [{ name: 'Priority:p0', color: 'EDEDED', description: null }],
        [label]
      )
    ).toEqual([{ kind: 'update-label', currentName: 'Priority:p0', label }])
  })
})

describe('milestone sync plan', () => {
  it('creates, updates and reopens milestones by title', () => {
    expect(planMilestoneOps([], [milestone])).toEqual([
      { kind: 'create-milestone', milestone }
    ])
    expect(
      planMilestoneOps(
        [
          {
            number: 3,
            title: 'M0 Stabilize',
            description: 'Old',
            state: 'open'
          }
        ],
        [milestone]
      )
    ).toEqual([{ kind: 'update-milestone', number: 3, milestone }])
    expect(
      planMilestoneOps(
        [
          {
            number: 3,
            title: 'M0 Stabilize',
            description: 'Goal',
            state: 'closed'
          }
        ],
        [milestone]
      )
    ).toEqual([{ kind: 'update-milestone', number: 3, milestone }])
    expect(
      planMilestoneOps(
        [
          {
            number: 3,
            title: 'M0 Stabilize',
            description: 'Goal',
            state: 'open'
          }
        ],
        [milestone]
      )
    ).toEqual([])
  })
})

describe('issue milestone sync plan', () => {
  const desired = new Map([
    ['STAB-001', 'M0 Stabilize'],
    ['epic:ONB', 'M2 Onboarding']
  ])
  const milestones = [
    { number: 1, title: 'M0 Stabilize' },
    { number: 3, title: 'M2 Onboarding' }
  ]

  it('moves roadmap issues into their milestone by title key', () => {
    expect(
      planIssueMilestoneOps(
        [
          {
            number: 10,
            title: 'STAB-001 Scheduled job worker',
            milestone: null
          },
          {
            number: 11,
            title: 'Epic: ONB · Onboarding',
            milestone: { number: 1 }
          },
          { number: 12, title: 'Unrelated bug report' },
          { number: 13, title: 'STAB-001 PR', pull_request: {} }
        ],
        milestones,
        desired
      )
    ).toEqual([
      {
        kind: 'set-issue-milestone',
        issue: 10,
        key: 'STAB-001',
        milestone: 1,
        title: 'M0 Stabilize'
      },
      {
        kind: 'set-issue-milestone',
        issue: 11,
        key: 'epic:ONB',
        milestone: 3,
        title: 'M2 Onboarding'
      }
    ])
  })

  it('does nothing when issues are already placed', () => {
    expect(
      planIssueMilestoneOps(
        [{ number: 10, title: 'STAB-001 Worker', milestone: { number: 1 } }],
        milestones,
        desired
      )
    ).toEqual([])
  })

  it('fails loudly when a milestone does not exist yet', () => {
    expect(() =>
      planIssueMilestoneOps(
        [{ number: 11, title: 'Epic: ONB · Onboarding' }],
        [{ number: 1, title: 'M0 Stabilize' }],
        desired
      )
    ).toThrow(/M2 Onboarding/)
  })
})
