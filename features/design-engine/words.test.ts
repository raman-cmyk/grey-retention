import { describe, expect, it } from 'vitest'
import { cutTo, wordPicker, wordsAllowed } from './words'
import { trimTo } from './copy'

const rules = { offer: { code: 'FERN15', percent: 15 }, maxDiscountPercent: 20 }

describe('brand words', () => {
  it('only the email’s own offer and code', () => {
    expect(wordsAllowed('15% off loose leaf', rules)).toBe(true)
    expect(wordsAllowed('Use code FERN15', rules)).toBe(true)
    expect(wordsAllowed('25% off everything', rules)).toBe(false)
    expect(wordsAllowed('10% off', rules)).toBe(false)
    expect(wordsAllowed('Use SAVE20 today', rules)).toBe(false)
    expect(
      wordsAllowed('15% off', { offer: null, maxDiscountPercent: 20 })
    ).toBe(false)
    expect(
      wordsAllowed('15% off', {
        offer: { code: 'FERN15', percent: 15 },
        maxDiscountPercent: 10
      })
    ).toBe(false)
  })

  it('picks the text whose length fits the slot, each once while others are left', () => {
    const pick = wordPicker(
      {
        headline: ['Short', 'A headline of medium size', 'Tiny one'],
        body: [],
        button: ['Go']
      },
      rules
    )
    expect(pick.pick('headline', 24)).toBe('A headline of medium size')
    expect(pick.pick('headline', 24)).toBe('Tiny one')
    expect(pick.pick('main_button', 8)).toBe('Go')
  })

  it('a long paragraph slot takes more sentences; more() lengthens without repeating', () => {
    const pick = wordPicker(
      {
        headline: [],
        body: ['One two three.', 'Four five six.', 'Seven.'],
        button: []
      },
      rules
    )
    expect(pick.pick('body', 30)).toBe('One two three. Four five six.')
    expect(pick.more('body', 'One two three.', 40)).toBe(
      'One two three. Four five six. Seven.'
    )
    expect(pick.more('body', 'One two three. Four five six. Seven.', 80)).toBe(
      null
    )
  })

  it('cuts at a space, never inside a word', () => {
    expect(cutTo('Brew a better cup of tea', 12)).toBe('Brew a')
    expect(cutTo('Short', 12)).toBe('Short')
    expect(trimTo('Brew a better cup, of tea', 0.75)).toBe('Brew a better cup')
    expect(trimTo('Word', 0.1)).toBe('Word')
    expect(trimTo('Two words', 1)).toBe('Two')
  })
})
