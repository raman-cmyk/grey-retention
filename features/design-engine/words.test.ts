import { describe, expect, it } from 'vitest'
import { cutTo, holdsFacts, wordPicker, wordsAllowed } from './words'
import { shorten, trimTo } from './copy'

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
      'Use code at checkout'
    ])
      expect(wordsAllowed(words, rules), words).toBe(true)
    // The offer above the max is not the email's to give.
    expect(
      wordsAllowed('Use code FERN15', { ...rules, maxDiscountPercent: 10 })
    ).toBe(false)
  })

  it('money only from the store’s facts, with no offer', () => {
    const none = {
      offer: null,
      maxDiscountPercent: 20,
      amounts: ['$14.00', '$12.00'],
      claims: []
    }
    for (const words of [
      'Was $20, now $14',
      'Now only $12',
      'Prices from $9',
      '2 for $30',
      'Gift card worth $25',
      'Buy 3, get 1 free',
      'Spend 50 get 10 off',
      'Ten dollars off',
      'Twenty percent off',
      'Free gift with every order',
      'Free shipping on orders over $50',
      'Enter WELCOME at checkout',
      'Apply spring10 in checkout',
      'A tin for $99',
      '15% off loose leaf'
    ])
      expect(wordsAllowed(words, none), words).toBe(false)
    for (const words of [
      'Hill green, $14.00',
      'A tin for $14',
      '100% organic',
      '100 percent natural',
      'Promo video inside',
      'B12-rich leaves',
      'SPF50 for sunny days',
      'Free from additives',
      'Steep for three minutes'
    ])
      expect(wordsAllowed(words, none), words).toBe(true)
    // An approved claim says a fact, word for word.
    const claimed = {
      ...none,
      claims: ['Free shipping on orders over $50', 'Free gift with every order']
    }
    expect(wordsAllowed('Free shipping on orders over $50.', claimed)).toBe(
      true
    )
    expect(wordsAllowed('Free gift with every order', claimed)).toBe(true)
    expect(wordsAllowed('Free shipping on every order', claimed)).toBe(false)
    // A percent next to a discount word is the offer's, else nothing.
    expect(wordsAllowed('15% off, 100% organic', rules)).toBe(true)
    expect(wordsAllowed('Fifteen percent off', rules)).toBe(true)
    expect(wordsAllowed('Twenty percent off', rules)).toBe(false)
    expect(wordsAllowed('Enter FERN15 at checkout', rules)).toBe(true)
  })

  it('never cuts words that carry a number, money, a code or a condition', () => {
    for (const words of [
      'Free shipping on orders over $50',
      '15% off loose leaf until Sunday only',
      'Ends at midnight',
      'Minimum two tins',
      'For new customers',
      'Selected tins only',
      'While stocks last',
      'Excludes gift sets and samplers',
      'Only on orders over forty dollars'
    ])
      expect(holdsFacts(words), words).toBe(true)
    for (const words of [
      'Brew a better cup',
      'Free from additives',
      'Only the best leaves',
      'Off to a great start'
    ])
      expect(holdsFacts(words), words).toBe(false)
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

  it('never drops a sentence that limits a promise', () => {
    expect(
      shorten('Free delivery this week. Only on orders over $40.', 0.5)
    ).toBe('Free delivery this week. Only on orders over $40.')
    expect(
      shorten('Take 15% off every tin. Excludes gift sets and samplers.', 0.5)
    ).toBe('Take 15% off every tin. Excludes gift sets and samplers.')
    expect(
      shorten('Our tins are refillable. We pick by hand at dawn.', 0.5)
    ).toBe('Our tins are refillable.')
  })
})
