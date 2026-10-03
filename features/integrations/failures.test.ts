import { expect, it } from 'vitest'
import { classifyFailure, ProviderFault } from './failures'
import { DisabledKlaviyoDeliveryProvider } from './klaviyo-contract'
it('classifies typed unknown outcomes separately from permanent and retryable faults', () => {
  expect(classifyFailure(new ProviderFault('unknown_outcome'))).toBe(
    'unknown_outcome'
  )
  expect(classifyFailure({ status: 429 })).toBe('rate_limit')
  expect(classifyFailure({ status: 401 })).toBe('auth')
  expect(classifyFailure({ status: 503 })).toBe('transient')
  expect(classifyFailure({ code: '23514' })).toBe('validation')
})
it('keeps every live delivery operation disabled', async () => {
  const provider = new DisabledKlaviyoDeliveryProvider()
  for (const method of [
    'prepare',
    'schedule',
    'state',
    'reschedule',
    'cancel',
    'reconcile',
    'results'
  ] as const)
    await expect(provider[method]()).rejects.toThrow('disabled')
})
