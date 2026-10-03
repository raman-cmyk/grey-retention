import { it, expect } from 'vitest'
import { sanitizeLog } from './sanitize-log.mjs'
it('removes URL capabilities and bearer/JWT shaped secrets before output', () => {
  const fixture = 'eyJfictional.payload.signature'
  const cleaned = sanitizeLog(
    `Image https://fixture.example/image?token=${fixture}&width=600 Authorization: Bearer fictional-token`
  )
  expect(cleaned).not.toContain(fixture)
  expect(cleaned).not.toContain('fictional-token')
  expect(cleaned).toContain('width=600')
  expect(sanitizeLog('20 passed · fixture renderer')).toBe(
    '20 passed · fixture renderer'
  )
})
