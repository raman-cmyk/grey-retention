import { describe, expect, it } from 'vitest'
import { cutTo, holdsFacts, wordPicker, wordsAllowed } from './words'
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

  it('never money off, half price, buy one get one, or a code that is not the email’s own', () => {
    for (const words of [
      '$10 off your order',
      'Save $10 today',
      'Take €5 off',
      '5 dollars off',
      'Half price on tins',
      'Half-off everything',
      'BOGO weekend',
      'Buy one, get one free',
      'Two for one on mugs',
      'Use code spring',
      'Use code SPRING',
      'Coupon: tea10',
      'Promo code welcome'
    ])
      expect(wordsAllowed(words, rules), words).toBe(false)
    for (const words of [
      'Use code FERN15',
      'use code fern15',
      'Use code at checkout',
      'Free shipping on orders over $50',
      'From $14.00'
    ])
      expect(wordsAllowed(words, rules), words).toBe(true)
    // The offer above the max is not the email's to give.
    expect(
      wordsAllowed('Use code FERN15', { ...rules, maxDiscountPercent: 10 })
    ).toBe(false)
  })

  it('never cuts words that carry a number, money, a code or a condition', () => {
    for (const words of [
      'Free shipping on orders over $50',
      '15% off loose leaf until Sunday only',
      'Ends at midnight',
      'Minimum two tins'
    ])
      expect(holdsFacts(words), words).toBe(true)
    expect(holdsFacts('Brew a better cup')).toBe(false)
    const pick = wordPicker(
      {
        headline: ['Free shipping on orders over $50', 'Steep, sip, repeat'],
        body: [
          'Every order ships in a tin.',
          'Orders over $50 ship free until Sunday.'
        ],
        button: []
      },
      rules
    )
    // Too long to fit whole: the other headline, never "Free shipping".
    expect(pick.pick('headline', 18)).toBe('Steep, sip, repeat')
    expect(pick.pick('headline', 18)).toBe('Steep, sip, repeat')
    // A paragraph takes sentences with facts only whole.
    expect(pick.pick('body', 30)).toBe('Every order ships in a tin.')
    // Nothing fits: no words (the section is built from a block).
    const tight = wordPicker(
      { headline: ['Free shipping on orders over $50'], body: [], button: [] },
      rules
    )
    expect(tight.pick('headline', 10)).toBe(null)
  })
})
