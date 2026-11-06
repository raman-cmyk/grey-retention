export type Label = { name: string; color: string; description: string }

export type RegisterFeature = {
  id: string
  category: string
  feature: string
  priority: string
  acceptance: string
  status: string
  implementation_tasks?: string[]
  verification?: string[]
  remaining?: string | null
}

export type Register = { features: RegisterFeature[] }

export type RoadmapWorkItem = {
  id: string
  title: string
  milestone: string
  priority: string
  type: string
  area: string
  problem: string
  scope: string[]
  doneWhen: string
  blockedBy?: string
}

export type Roadmap = {
  labels: {
    priority: Label[]
    type: Label[]
    extra: Label[]
    areaColor: string
  }
  milestones: Array<{
    key: string
    title: string
    goal: string
    doneWhen: string
  }>
  categories: Record<string, { area: string; milestone: string }>
  milestoneOverrides: Record<string, string>
  typeOverrides?: Record<string, string>
  workItems: RoadmapWorkItem[]
}

export type PlannedMilestone = {
  key: string
  title: string
  description: string
}

export type PlannedIssue = {
  key: string
  title: string
  labels: string[]
  milestone: string
  body: string
  id?: string
  prefix?: string
  epic?: string
}

export type Plan = {
  labels: Label[]
  milestones: PlannedMilestone[]
  epics: PlannedIssue[]
  workItems: PlannedIssue[]
  items: PlannedIssue[]
}

export const REPOSITORY_URL: string
export function loadInputs(root?: string): {
  register: Register
  roadmap: Roadmap
}
export function prefixOf(id: string): string
export function slugify(text: string): string
export function branchName(id: string, title: string): string
export function issueKey(title: string): string | null
export function buildPlan(register: Register, roadmap: Roadmap): Plan
export function milestoneByIssueKey(plan: Plan): Map<string, string>
export function summaryMarkdown(plan: Plan): string
