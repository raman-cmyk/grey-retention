import { describe, expect, it } from 'vitest'
import { isLinkOnly, outcomeFor } from './compose'

describe('composer helpers', () => {
  it('maps only the available modes to an existing outcome', () => {
    expect(outcomeFor('exact')).toBe('copy')
    expect(outcomeFor('rebrand')).toBe('rewrite')
    expect(outcomeFor('adapt')).toBeNull()
    expect(outcomeFor('anything')).toBeNull()
  })

  it('recognises a pasted link that we cannot read yet', () => {
    expect(isLinkOnly('https://brand.example/email')).toBe(true)
    expect(isLinkOnly('  www.brand.example  ')).toBe(true)
    expect(isLinkOnly('Spring sale https://brand.example')).toBe(false)
    expect(isLinkOnly('<p>Hello</p>')).toBe(false)
  })
})
