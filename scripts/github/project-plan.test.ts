import { describe, expect, it } from 'vitest'
import {
  branchName,
  buildPlan,
  issueKey,
  loadInputs,
  milestoneByIssueKey,
  prefixOf,
  type Roadmap
} from './project-plan.mjs'

const { register, roadmap } = loadInputs()
const plan = buildPlan(register, roadmap)
const allIssues = [...plan.epics, ...plan.workItems, ...plan.items]
const clone = (value: Roadmap): Roadmap => structuredClone(value)

describe('roadmap plan from the feature register', () => {
  it('creates one issue per P0 register item and one epic per category', () => {
    const p0 = register.features.filter((f) => f.priority === 'P0')
    const prefixes = new Set(register.features.map((f) => prefixOf(f.id)))
    expect(plan.items.map((i) => i.id)).toEqual(p0.map((f) => f.id))
    expect(plan.epics.map((e) => e.prefix).sort()).toEqual([...prefixes].sort())
    expect(plan.milestones.map((m) => m.title)).toEqual([
      'M0 Stabilize',
      'M1 Design system',
      'M2 Onboarding',
      'M3 Competitor watch',
      'M4 Replication engine',
      'M5 Store + delivery',
      'M6 Intelligence'
    ])
  })

  it('labels every issue with existing priority, type and area labels', () => {
    const names = new Set(plan.labels.map((l) => l.name))
    for (const issue of [...plan.items, ...plan.workItems]) {
      expect(
        issue.labels.filter((l) => l.startsWith('priority:'))
      ).toHaveLength(1)
      expect(issue.labels.filter((l) => l.startsWith('type:'))).toHaveLength(1)
      expect(issue.labels.filter((l) => l.startsWith('area:'))).toHaveLength(1)
    }
    for (const label of allIssues.flatMap((i) => i.labels))
      expect(names.has(label), label).toBe(true)
    for (const label of plan.labels) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/)
      expect(label.description.length).toBeLessThanOrEqual(100)
    }
  })

  it('keeps titles unique and recoverable as stable keys', () => {
    expect(new Set(allIssues.map((i) => i.title)).size).toBe(allIssues.length)
    for (const issue of allIssues) expect(issueKey(issue.title)).toBe(issue.key)
    const milestones = new Set(plan.milestones.map((m) => m.title))
    for (const title of milestoneByIssueKey(plan).values())
      expect(milestones.has(title)).toBe(true)
  })

  it('follows the owner milestone brief', () => {
    const inMilestone = (title: string) =>
      plan.items
        .concat(plan.workItems)
        .filter((i) => i.milestone === title)
        .map((i) => i.key)
    const onboarding = register.features
      .filter((f) => f.id.startsWith('ONB-'))
      .map((f) => f.id)
    expect(inMilestone('M2 Onboarding')).toEqual(
      expect.arrayContaining(onboarding)
    )
    expect(inMilestone('M0 Stabilize')).toEqual(
      expect.arrayContaining([
        'STAB-001',
        'STAB-002',
        'STAB-003',
        'STAB-004',
        'STAB-005'
      ])
    )
    expect(inMilestone('M1 Design system')).toContain('DS-006')
  })

  it('lists every P1/P2 item exactly once, in its own category epic', () => {
    for (const feature of register.features.filter(
      (f) => f.priority !== 'P0'
    )) {
      const holders = plan.epics.filter((e) =>
        e.body.includes(`\`${feature.id}\` `)
      )
      expect(holders.map((e) => e.prefix)).toEqual([prefixOf(feature.id)])
    }
  })

  it('keeps issue bodies within GitHub limits and states the acceptance', () => {
    for (const issue of allIssues)
      expect(issue.body.length).toBeLessThan(65_536)
    for (const feature of register.features.filter(
      (f) => f.priority === 'P0'
    )) {
      const issue = plan.items.find((i) => i.id === feature.id)!
      expect(issue.body).toContain(feature.acceptance)
      expect(issue.body).toContain(`\`${feature.status}\``)
      expect(issue.body).toContain('### Done when')
    }
  })

  it('rejects inconsistent roadmap configuration', () => {
    const missingCategory = clone(roadmap)
    delete missingCategory.categories.ONB
    expect(() => buildPlan(register, missingCategory)).toThrow(/ONB-001/)

    const unknownOverride = clone(roadmap)
    unknownOverride.milestoneOverrides['ZZZ-001'] = 'M1'
    expect(() => buildPlan(register, unknownOverride)).toThrow(/ZZZ-001/)

    const badMilestone = clone(roadmap)
    badMilestone.milestoneOverrides['ONB-001'] = 'M9'
    expect(() => buildPlan(register, badMilestone)).toThrow(/M9/)

    const collision = clone(roadmap)
    collision.workItems[0] = { ...collision.workItems[0], id: 'ONB-999' }
    expect(() => buildPlan(register, collision)).toThrow(/collides/)
  })
})

describe('roadmap naming helpers', () => {
  it('derives branch names from IDs', () => {
    expect(branchName('ONB-002', 'Single merchant URL first screen')).toBe(
      'claude/onb-002-single-merchant-url-first-screen'
    )
    expect(branchName('DS-006', 'Composer (Exact / Rebrand / Adapt)')).toBe(
      'claude/ds-006-composer-exact-rebrand-adapt'
    )
  })

  it('parses issue keys and ignores unrelated titles', () => {
    expect(issueKey('Epic: ONB · Onboarding')).toBe('epic:ONB')
    expect(issueKey('WATCH-021 Observed sequence reconstruction')).toBe(
      'WATCH-021'
    )
    expect(issueKey('Fix the login page')).toBeNull()
    expect(issueKey('Epic: something')).toBeNull()
    expect(() => prefixOf('onb-1')).toThrow()
  })
})
