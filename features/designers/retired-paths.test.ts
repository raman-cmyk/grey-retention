import { describe, expect, it } from 'vitest'
import { isRetiredDesignerPath } from './retired-paths'

describe('retired designer paths (decision D3)', () => {
  it('covers the designer workspace, its sign-in and the admin page', () => {
    for (const path of [
      '/designer',
      '/designer/login',
      '/designer/dashboard',
      '/designer/assignments/abc',
      '/Designer/Help',
      '/admin/designers',
      '/admin/designers/'
    ])
      expect(isRetiredDesignerPath(path), path).toBe(true)
  })

  it('leaves every other screen alone', () => {
    for (const path of [
      '/admin/dashboard',
      '/admin/designers-archive',
      '/designers',
      '/campaigns/designer',
      '/dashboard'
    ])
      expect(isRetiredDesignerPath(path), path).toBe(false)
  })
})
