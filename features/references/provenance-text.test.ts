import { describe, expect, it } from 'vitest'
import { provenanceSentence } from './provenance-text'

describe('provenanceSentence', () => {
  it('says an exact copy is a copy', () => {
    const text = provenanceSentence('copy', [])
    expect(text).toContain('exact copy')
    expect(text).not.toContain('not copied')
  })

  it('describes a rewrite', () => {
    expect(provenanceSentence('rewrite', [])).toContain('rewrites the email')
  })

  it('lists outline parts for an outline draft', () => {
    expect(provenanceSentence(undefined, ['Hero', ' ', 'Offer'])).toContain(
      'outline of the email you added: Hero · Offer.'
    )
  })

  it('never prints an empty outline', () => {
    const text = provenanceSentence(undefined, [])
    expect(text).not.toMatch(/: \./)
    expect(text).toContain('started from the email you added')
  })
})
