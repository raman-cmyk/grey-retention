// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pushReason, pushRefusalWords } from './failure-words'

/** REL-084c: why Klaviyo, or the last check before it, refused the draft. */
describe('the words for a push refusal (REL-084c)', () => {
  it('has words for every refusal the pusher can store', () => {
    const dir = path.resolve(__dirname, '..', 'klaviyo-push')
    const reasons = new Set<string>()
    for (const file of ['pusher.ts', 'html.ts']) {
      const text = readFileSync(path.join(dir, file), 'utf8')
      for (const m of text.matchAll(/new Refused\('([a-z_]+)'/g))
        reasons.add(m[1]!)
      // The checks before Klaviyo is called return their reason.
      for (const m of text.matchAll(/return \{ reason: '([a-z_]+)'/g))
        reasons.add(m[1]!)
      // A refusal saved straight on the push row.
      for (const m of text.matchAll(/state: 'refused', reason: '([a-z_]+)'/g))
        reasons.add(m[1]!)
    }
    expect(reasons.size).toBeGreaterThan(10)
    expect([...reasons].filter((r) => !pushReason(r))).toEqual([])
  })

  it('gives fixed plain words for a known refusal, and none for another', () => {
    expect(pushReason('externally_modified')).toBe(
      'Its draft was changed or deleted in Klaviyo, so it was left as it is.'
    )
    for (const unknown of [null, undefined, '', 'something_new', 'toString'])
      expect(pushReason(unknown)).toBeNull()
    // Words for the owner: never a code, a key or Klaviyo's own message.
    for (const words of Object.values(pushRefusalWords)) {
      expect(words).toMatch(/^[A-Z].*\.$/)
      expect(words).not.toMatch(/[a-z]+_[a-z]+/)
    }
  })
})
