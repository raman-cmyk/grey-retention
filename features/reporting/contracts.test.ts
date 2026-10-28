import { describe, it, expect } from 'vitest'
import { resultSchema } from './contracts'
import { generateFixtureCopy } from '@/features/ai/fixture-copy'
const fixture = {
  deliveryId: '00000000-0000-4000-8000-000000000099',
  window: '7d',
  source: 'fixture',
  windowStart: '2026-10-01T00:00:00Z',
  windowEnd: '2026-10-08T00:00:00Z',
  collectedAt: '2026-10-08T00:00:00Z',
  complete: false,
  comparable: false,
  recipients: 100,
  clicks: 5,
  revenueMinor: 100,
  currency: 'USD',
  unsubscribes: 1,
  spam: 0,
  confounders: ['Synthetic fixture; incomplete']
}
describe('windowed reporting boundaries', () => {
  it('retains incomplete and incomparable evidence rather than inventing completeness', () => {
    expect(resultSchema.parse(fixture).complete).toBe(false)
  })
  it('rejects impossible counters, unsupported currencies and immature windows', () => {
    for (const patch of [
      { clicks: 101 },
      { spam: -1 },
      { currency: 'EUR' },
      { collectedAt: '2026-10-07T23:00:00Z' }
    ])
      expect(resultSchema.safeParse({ ...fixture, ...patch }).success).toBe(
        false
      )
  })
  it('applies a pinned advisory subject preference with explicit evidence lineage and no added claims', () => {
    const x = generateFixtureCopy({
      brandRevision: 1,
      brandName: 'Fictional Studio',
      title: 'An original note',
      productTitle: null,
      url: 'https://studio.example/',
      learningPreference: {
        ruleId: fixture.deliveryId,
        preferredGroup: 'short',
        evidenceHash: 'a'.repeat(64)
      }
    })
    expect(x.subject.length).toBeLessThanOrEqual(40)
    expect(x.learningPreference?.ruleId).toBe(fixture.deliveryId)
    expect(x.body).toContain(
      'No discount, performance claim or deadline is implied'
    )
  })
})
