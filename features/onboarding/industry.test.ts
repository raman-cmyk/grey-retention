import { describe, expect, it } from 'vitest'
import { industriesInWords, industryInWords, industryScores } from './industry'

describe('industryInWords (ONB-062)', () => {
  it('reads whole sentences, whole words only', () => {
    const cases: [string, string][] = [
      ['Sells menswear basics: overshirts, knitwear and bags.', 'apparel'],
      ['A small shop offering organic dog treats and toys', 'pet'],
      ['Handmade oak chairs and dining tables for the home', 'home'],
      ['Scented soy candles for spring', 'home'],
      [
        'Specialty coffee beans, roasted fresh and shipped during the week',
        'food_drink'
      ],
      ['Wireless earbuds and speakers that last all day', 'electronics'],
      ['Linen clothing for warm weather', 'apparel'],
      ['Vitamin C serums for dull skin', 'skincare'],
      ['Gold rings, necklaces and earrings', 'jewelry'],
      ['Professional hair tools and straighteners', 'beauty_tools'],
      ['Shampoo and conditioner bars', 'haircare'],
      ['Daily vitamins and protein powders', 'supplements'],
      ['CBD oils for calm evenings', 'wellness'],
      ['Yoga mats and gym gear', 'fitness'],
      ['Organic cotton baby clothes and nursery decor', 'baby'],
      ['Cast iron cookware and chef knives', 'kitchen'],
      ['Home fragrance: diffusers and room sprays', 'home'],
      ['Lightweight tents for hiking and camping', 'outdoor'],
      ['Dog-friendly travel gear', 'pet'],
      ['Mystery boxes delivered monthly', 'other']
    ]
    for (const [text, industry] of cases)
      expect([text, industryInWords(text)]).toEqual([text, industry])
  })

  it('takes a value already on the list, and nothing for no words', () => {
    expect(industryInWords('skincare')).toBe('skincare')
    expect(industryInWords('BEAUTY_TOOLS')).toBe('beauty_tools')
    expect(industryInWords('  ')).toBeNull()
    expect(industryInWords(null)).toBeNull()
  })

  it('never takes part of a word, and puts who it is for first', () => {
    const cases: [string, string][] = [
      ['Pet accessories', 'pet'],
      ['Dog collars and accessories', 'pet'],
      ['Baby clothing', 'baby'],
      ['Organic baby sleepwear', 'baby'],
      ['Things that make dogs happy', 'pet'],
      ['Office chairs', 'home'],
      ['Bespoke tailoring', 'apparel'],
      ['Skinny jeans', 'apparel'],
      ['Spring water', 'other'],
      ['Smart home devices', 'electronics'],
      ['Hot dogs and buns', 'food_drink'],
      ['Herbal teas', 'food_drink'],
      ['Mineral sunscreen', 'skincare'],
      ['Massage guns', 'wellness']
    ]
    for (const [text, industry] of cases)
      expect([text, industryInWords(text)]).toEqual([text, industry])
  })

  it('knows the everyday words of small shops', () => {
    const cases: [string, string][] = [
      ['Natural face creams and body lotions', 'skincare'],
      ['Handmade soaps', 'skincare'],
      ['Body butter and lip balm', 'skincare'],
      ['Natural flea and tick collars', 'pet'],
      ['Silicone teethers', 'baby'],
      ['Reusable cloth nappies', 'baby'],
      ['Ceremonial matcha', 'food_drink'],
      ['Glassware, dinnerware and drinkware', 'kitchen'],
      ['Candies and sweets', 'food_drink'],
      ['Hair dryers', 'beauty_tools'],
      ['Beauty-tools for home', 'beauty_tools'],
      ['Ring lights for creators', 'electronics']
    ]
    for (const [text, industry] of cases)
      expect([text, industryInWords(text)]).toEqual([text, industry])
  })

  it('lets a two-word name use up both its words', () => {
    expect(industriesInWords('Ice cream and sorbet')).toEqual(['food_drink'])
    expect(industriesInWords('Hot dogs and buns')).toEqual(['food_drink'])
    expect(industriesInWords('Smart home devices')).toEqual(['electronics'])
    expect(industriesInWords('Sleep sacks and swaddles for babies')).toEqual([
      'baby'
    ])
    expect(industryScores('Professional hair tools and straighteners')).toEqual(
      [{ industry: 'beauty_tools', words: 3 }]
    )
  })

  it('lists every industry named, most words first', () => {
    expect(
      industriesInWords(
        'Organic cotton baby sleepwear and swaddles, gentle on sensitive skin'
      )
    ).toEqual(['baby', 'skincare', 'apparel'])
    expect(
      industriesInWords('Sells menswear basics: overshirts, knitwear and bags.')
    ).toEqual(['apparel', 'accessories'])
    expect(industriesInWords('other')).toEqual([])
    expect(industryInWords('other')).toBe('other')
  })

  it('never reads eyewear as clothes', () => {
    expect(industryInWords('Handmade eyewear')).toBe('accessories')
  })
})
