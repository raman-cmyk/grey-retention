import { describe, expect, it } from 'vitest'
import { plannerBack } from './back'

describe('back to the plan', () => {
  it('opens the Plan from a page the old planner opened', () => {
    expect(
      plannerBack({ from: 'planner', m: '2026-10', view: 'table' })
    ).toEqual({ href: '/plan', label: 'Back to the plan' })
    expect(plannerBack({ from: ['planner'] })?.href).toBe('/plan')
  })

  it('ignores other sources', () => {
    expect(plannerBack({ from: 'campaigns' })).toBeNull()
    expect(plannerBack({})).toBeNull()
  })
})
