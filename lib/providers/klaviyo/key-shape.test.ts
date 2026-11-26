import { describe, expect, it } from 'vitest'
import { klaviyoPrivateKeyPattern } from './key-shape'

describe('Klaviyo private key shape', () => {
  it('keeps the existing key-length boundaries', () => {
    for (const size of [20, 64])
      expect(klaviyoPrivateKeyPattern.test(`pk_${'a'.repeat(size)}`)).toBe(true)
    for (const size of [19, 65])
      expect(klaviyoPrivateKeyPattern.test(`pk_${'a'.repeat(size)}`)).toBe(
        false
      )
  })

  it('allows separators only where the stored hint does not expose them', () => {
    expect(
      klaviyoPrivateKeyPattern.test('pk_SAMPLE_0123456789abcdefghij')
    ).toBe(true)
    for (const key of [
      'pk_SAM_LE0123456789abcdefghij',
      'pk_SAMPLE0123456789abcdefg_ij'
    ])
      expect(klaviyoPrivateKeyPattern.test(key)).toBe(false)
  })

  it.each([' ', '\t', '\r\nX-Evil: 1', '/', '\u0000', 'é'])(
    'rejects unsafe characters in the middle of a key',
    (unsafe) => {
      expect(
        klaviyoPrivateKeyPattern.test(`pk_SAMPLE${unsafe}0123456789abcdefghij`)
      ).toBe(false)
    }
  )
})
