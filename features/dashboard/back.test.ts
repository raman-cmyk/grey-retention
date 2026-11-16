import { describe, expect, it } from 'vitest'
import { dashboardBack } from './back'

describe('dashboardBack (UI-HOMEb)', () => {
  it('goes back to Home now the old dashboard is retired', () => {
    for (const from of ['campaigns', 'flows', 'lists', undefined, 42, 'x'])
      expect(dashboardBack(from)).toEqual({
        href: '/home',
        label: 'Back to Home'
      })
  })
})
