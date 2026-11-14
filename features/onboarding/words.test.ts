// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { asWritten, plain, wellFormed } from './words'

describe('a quote found in a source’s own words', () => {
  it('keeps the source’s own capitals and spacing aside', () => {
    expect(asWritten(['So soft and WARM.'], 'soft and  warm')).toBe(
      'soft and WARM'
    )
  })

  it('never starts or ends inside a word in a script with spaces', () => {
    expect(asWritten(['It does not itch.'], 'oes not itch')).toBeNull()
    expect(asWritten(['Lovely knits'], 'Lovely knit')).toBeNull()
    // A combining accent is part of its letter: "café" is not "cafe".
    expect(asWritten(['Best café au lait'], 'Best cafe')).toBeNull()
    expect(asWritten(['Привет, мир'], 'ривет')).toBeNull()
  })

  it('finds a phrase in a script written without spaces', () => {
    expect(
      asWritten(['このセーターはとても暖かいです。'], 'とても暖かい')
    ).toBe('とても暖かい')
    expect(asWritten(['这件毛衣非常暖和'], '非常暖和')).toBe('非常暖和')
  })
})

describe('text the database can store', () => {
  it('turns half of a broken character pair into the replacement character', () => {
    expect(wellFormed('Love it \uD83D and the fit')).toBe(
      'Love it � and the fit'
    )
    expect(wellFormed('\uDE00 alone')).toBe('� alone')
    // A whole emoji stays.
    expect(wellFormed('Love it 😀')).toBe('Love it 😀')
  })

  it('says a sentence with a number or a claim is not plain', () => {
    expect(plain('Customers love the soft knit.')).toBe(true)
    expect(plain('Customers give it 5 stars.')).toBe(false)
    expect(plain('The best knit there is.')).toBe(false)
  })
})
