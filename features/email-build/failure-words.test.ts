// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCode,
  buildReason,
  pushRefusalWords,
  refusedCode
} from './failure-words'

/** REL-084c: why the app's own checks refused the draft for Klaviyo. */
describe('the words for a push refusal (REL-084c)', () => {
  it('has words for every refusal the pusher can give', () => {
    const dir = path.resolve(__dirname, '..', 'klaviyo-push')
    const reasons = new Set<string>()
    for (const file of ['pusher.ts', 'html.ts']) {
      const text = readFileSync(path.join(dir, file), 'utf8')
      for (const m of text.matchAll(/new Refused\(\s*'([a-z_]+)'/g))
        reasons.add(m[1]!)
      // The checks before Klaviyo is called return their reason.
      for (const m of text.matchAll(/return\s*\{\s*reason:\s*'([a-z_]+)'/g))
        reasons.add(m[1]!)
      // A refusal saved straight on the push row.
      for (const m of text.matchAll(
        /state:\s*'refused',\s*reason:\s*'([a-z_]+)'/g
      ))
        reasons.add(m[1]!)
    }
    expect(reasons.size).toBeGreaterThan(10)
    expect(reasons).toContain('final_checks')
    expect(reasons).toContain('too_many_pictures')
    expect(
      [...reasons].filter((r) => !Object.hasOwn(pushRefusalWords, r))
    ).toEqual([])
  })

  it('stores the refusal in the build’s own code, which the database takes', () => {
    expect(refusedCode('final_checks')).toBe('klaviyo_refused_final_checks')
    // Klaviyo's own refusal of a request, or an unknown reason: the general code.
    for (const unknown of [undefined, null, '', 'something_new', 'toString'])
      expect(refusedCode(unknown)).toBe('klaviyo_rejected')
    for (const reason of Object.keys(pushRefusalWords)) {
      const code = refusedCode(reason)
      // `fail_email_step`'s rule for a code.
      expect(code).toMatch(/^[a-z][a-z0-9_]{1,59}$/)
      expect(buildCode(code)).toBe(code)
      expect(buildReason(code)).toBe(
        pushRefusalWords[reason as keyof typeof pushRefusalWords]
      )
    }
    for (const unknown of ['klaviyo_refused_', 'klaviyo_refused_toString'])
      expect(buildCode(unknown)).toBe('step_error')
    expect(buildReason('klaviyo_rejected')).toBe(
      'Klaviyo, or the last check before Klaviyo, refused it.'
    )
  })

  it('gives fixed plain words, never a code, a key or Klaviyo’s own message', () => {
    expect(buildReason('klaviyo_refused_externally_modified')).toBe(
      'Its draft was changed or deleted in Klaviyo, so it was left as it is.'
    )
    for (const words of Object.values(pushRefusalWords)) {
      expect(words).toMatch(/^[A-Z].*\.$/)
      expect(words).not.toMatch(/[a-z]+_[a-z]+/)
    }
  })
})
