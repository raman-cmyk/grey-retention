import type { Label, PlannedMilestone } from './project-plan.mjs'

export type LabelOp =
  | { kind: 'create-label'; label: Label }
  | { kind: 'update-label'; currentName: string; label: Label }

export type MilestoneOp =
  | { kind: 'create-milestone'; milestone: PlannedMilestone }
  | { kind: 'update-milestone'; number: number; milestone: PlannedMilestone }

export type IssueMilestoneOp = {
  kind: 'set-issue-milestone'
  issue: number
  key: string
  milestone: number
  title: string
}

export function planLabelOps(
  current: Array<{ name: string; color: string; description?: string | null }>,
  desired: Label[]
): LabelOp[]

export function planMilestoneOps(
  current: Array<{
    number: number
    title: string
    description?: string | null
    state: string
  }>,
  desired: PlannedMilestone[]
): MilestoneOp[]

export function planIssueMilestoneOps(
  issues: Array<{
    number: number
    title: string
    milestone?: { number: number } | null
    pull_request?: unknown
  }>,
  milestones: Array<{ number: number; title: string }>,
  desiredByKey: Map<string, string>
): IssueMilestoneOp[]
