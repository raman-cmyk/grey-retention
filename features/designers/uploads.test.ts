import { expect, it } from 'vitest'
import { validateDesignBytes } from './uploads'
it('rejects executable/mislabeled/oversized submission content before Storage', () => {
  expect(() =>
    validateDesignBytes(
      new TextEncoder().encode('<html><script>bad()</script></html>'),
      'fake.png'
    )
  ).toThrow('signature')
  const png = new Uint8Array(16)
  png.set([137, 80, 78, 71, 13, 10, 26, 10])
  expect(validateDesignBytes(png, 'original.png').mediaType).toBe('image/png')
  expect(() => validateDesignBytes(png, 'original.svg')).toThrow('extension')
  expect(() =>
    validateDesignBytes(new Uint8Array(10 * 1024 * 1024 + 1), 'large.png')
  ).toThrow('10 MiB')
})
