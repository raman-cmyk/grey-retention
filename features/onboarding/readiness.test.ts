import { it, expect } from 'vitest'
import { readiness } from './readiness'
it('shows unmet resumable evidence and never substitutes elapsed time for readiness', () => {
  const base = {
    connected: true,
    approvedProfile: true,
    whitelistSaved: true,
    classifiedAssets: 19,
    competitors: [
      { status: 'live', emails: 10 },
      { status: 'live', emails: 9 },
      { status: 'pending', emails: 20 }
    ]
  }
  expect(readiness(base).ready).toBe(false)
  expect(
    readiness({
      ...base,
      classifiedAssets: 20,
      competitors: Array.from({ length: 3 }, () => ({
        status: 'live',
        emails: 10
      }))
    }).ready
  ).toBe(true)
  expect(
    readiness({
      ...base,
      classifiedAssets: 100,
      approvedProfile: false
    }).gates.find((g) => g.name === 'Owner-approved brand profile')?.met
  ).toBe(false)
})
