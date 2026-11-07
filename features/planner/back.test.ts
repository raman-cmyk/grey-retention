import { describe, expect, it } from 'vitest'
import { plannerBack } from './back'

const now = new Date('2026-11-06T12:00:00Z')

describe('back to the planner', () => {
  it('returns to the exact planner view', () => {
    expect(
      plannerBack(
        { from: 'planner', m: '2026-10', view: 'table', status: 'sent' },
        'UTC',
        now
      )
    ).toEqual({
      href: '/campaign-agent?m=2026-10&view=table&status=sent',
      label: 'Back to Campaigns'
    })
  })

  it('cleans up junk and ignores other sources', () => {
    expect(
      plannerBack({ from: ['planner'], m: '2026-99', status: 'x' }, 'UTC', now)
        ?.href
    ).toBe('/campaign-agent?m=2026-11')
    expect(plannerBack({ from: 'campaigns' }, 'UTC', now)).toBeNull()
    expect(plannerBack({}, 'UTC', now)).toBeNull()
  })
})
