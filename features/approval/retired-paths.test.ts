import { describe, expect, it } from 'vitest'
import { isRetiredApprovalPath } from './retired-paths'

describe('retired weekly approval paths (decision D17)', () => {
  it('covers the weekly copy review', () => {
    for (const path of ['/copy-review', '/copy-review/', '/Copy-Review/x'])
      expect(isRetiredApprovalPath(path), path).toBe(true)
  })

  it('leaves every other screen alone', () => {
    for (const path of [
      '/copy-reviews',
      '/campaigns/copy-review',
      '/campaign-agent',
      '/dashboard'
    ])
      expect(isRetiredApprovalPath(path), path).toBe(false)
  })
})
