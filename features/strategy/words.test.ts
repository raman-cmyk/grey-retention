import { describe, expect, it } from 'vitest'
import { statedFact } from './words'

describe('statedFact', () => {
  it('finds numbers, signs, number and date words, and codes', () => {
    expect(statedFact('Save 20 now')).toBe('a number or a money sign')
    expect(statedFact('Save £5')).toBe('a number or a money sign')
    expect(statedFact('One week only')).toBe('"one"')
    expect(statedFact('Per cent off')).toBe('"per cent"')
    expect(statedFact('Send it on Saturday')).toBe('"saturday"')
    expect(statedFact('Use WELCOME today', ['WELCOME'])).toBe('"today"')
    expect(statedFact('Use welcome at checkout', ['WELCOME'])).toBe(
      'a discount code'
    )
  })

  it('leaves plain words alone', () => {
    expect(statedFact('Someone often buys these', ['GIFT'])).toBeNull()
    expect(statedFact('A gifting idea for the home', ['GIFT'])).toBeNull()
    expect(statedFact('Lead with the new collection')).toBeNull()
  })
})
