import { it, expect } from 'vitest'
import { optimizerPayloadSchema } from './contracts'
import { DisabledLiveOptimizationProvider } from './provider'
const id = '00000000-0000-4000-8000-000000000099'
const payload = {
  sweepId: id,
  stage: 1,
  observedAt: '2026-10-04T00:00:00Z',
  source: 'fixture',
  synthetic: true,
  originalMessage: 'Original simulation',
  items: [
    {
      profileId: id,
      revision: 1,
      outcome: 'winback_1',
      reason: 'consented_fixture_winback'
    }
  ]
}
it('rejects duplicate profiles and suppression during an immature winback stage', () => {
  expect(
    optimizerPayloadSchema.safeParse({
      ...payload,
      items: [...payload.items, ...payload.items]
    }).success
  ).toBe(false)
  expect(
    optimizerPayloadSchema.safeParse({
      ...payload,
      items: [{ ...payload.items[0], outcome: 'suppressed' }]
    }).success
  ).toBe(false)
})
it('retains skipped evidence and forbids a live result source', () => {
  expect(
    optimizerPayloadSchema.parse({
      ...payload,
      items: [
        {
          ...payload.items[0],
          outcome: 'skipped',
          reason: 'protected_purchaser_12_months'
        }
      ]
    }).items[0]?.outcome
  ).toBe('skipped')
  expect(
    optimizerPayloadSchema.safeParse({ ...payload, source: 'provider' }).success
  ).toBe(false)
})
it('keeps live suppression unavailable without performing transport', async () => {
  await expect(
    new DisabledLiveOptimizationProvider().evaluate()
  ).rejects.toThrow('unavailable')
})
