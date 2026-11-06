import { describe, expect, it } from 'vitest'
import { startProgress } from './start-model'

describe('Saved setup progress', () => {
  it('resumes at the first missing record, even when later records exist', () => {
    expect(
      startProgress({ hasBrand: false, hasEmails: true, hasCampaign: true })
        .current
    ).toBe('brand')
    expect(
      startProgress({ hasBrand: true, hasEmails: false, hasCampaign: true })
        .current
    ).toBe('reference')
    expect(
      startProgress({ hasBrand: true, hasEmails: true, hasCampaign: false })
        .current
    ).toBe('draft')
  })
  it('completes only when all three persisted steps are satisfied', () => {
    expect(
      startProgress({ hasBrand: true, hasEmails: true, hasCampaign: true })
        .complete
    ).toBe(true)
    expect(
      startProgress({ hasBrand: true, hasEmails: false, hasCampaign: true })
        .complete
    ).toBe(false)
  })
})
