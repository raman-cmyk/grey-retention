import { describe, expect, it } from 'vitest'
import { formatMicroUsd, microUsdToUsd, usdToMicroUsd } from './money'

describe('money helpers', () => {
  it('round-trips USD through integer micro-USD', () => {
    expect(usdToMicroUsd(1.234567)).toBe(1_234_567)
    expect(microUsdToUsd(1_234_567)).toBe(1.234567)
  })

  it('formats small model-call costs without losing meaningful precision', () => {
    expect(formatMicroUsd(125_000)).toBe('$0.1250')
  })

  it('rejects unsafe values', () => {
    expect(() => microUsdToUsd(Number.MAX_VALUE)).toThrow('safe integer')
  })
})
