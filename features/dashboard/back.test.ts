import { describe, expect, it } from 'vitest'
import { dashboardBack } from './back'

describe('back to the dashboard', () => {
  it('returns to the tab the owner came from, scrolled to the card', () => {
    expect(dashboardBack('campaigns')).toEqual({
      href: '/dashboard?tab=campaigns#klaviyo-data',
      label: 'Back to dashboard'
    })
    expect(dashboardBack(['flows', 'x']).href).toBe(
      '/dashboard?tab=flows#klaviyo-data'
    )
  })

  it('sends anything unexpected to the top', () => {
    for (const bad of [
      undefined,
      '',
      'overview',
      'admin',
      '//evil.example',
      42
    ])
      expect(dashboardBack(bad).href).toBe('/dashboard')
  })
})
