import { describe, expect, it } from 'vitest'
import {
  checkCopy,
  defaultBannedClaims,
  type BrandFacts
} from '@/features/copy-qa/check'
import { industries } from '@/features/intelligence/taxonomy'
import {
  claimReason,
  claimsSafety,
  claimsSafetyPhrases,
  maxBannedPhrases,
  withClaimsSafety
} from './claims-safety'

const facts: BrandFacts = {
  freeShipping: null,
  deliveryDays: null,
  returnDays: null,
  guaranteeDays: null,
  approvedClaims: [],
  bannedPhrases: [],
  reviewsVerified: false
}
const keys = (industry: string | null) =>
  claimsSafety(industry).groups.map((g) => g.key)
const qa = (text: string, f: BrandFacts, productNames: string[] = []) =>
  checkCopy({
    draft: {
      subject: 'New this week',
      preview: 'Take a look',
      blocks: [{ id: 'b1', text }]
    },
    facts: f,
    maxDiscountPercent: null,
    codes: [],
    productNames,
    sendAt: '2026-11-20T15:00:00.000Z'
  }).failures.filter((x) => x.rule === 'banned_phrase')

describe('claimsSafety (ONB-062)', () => {
  it('gives every industry the green words, and its own groups', () => {
    for (const industry of industries)
      expect(keys(industry)[0], industry).toBe('green')
    expect(keys('skincare')).toEqual(['green', 'medical_beauty'])
    expect(keys('beauty_tools')).toEqual(['green', 'medical_beauty', 'germs'])
    expect(keys('supplements')).toEqual(['green', 'health', 'weight'])
    expect(keys('fitness')).toEqual([
      'green',
      'health',
      'weight_promises',
      'germs'
    ])
    expect(keys('food_drink')).toEqual([
      'green',
      'health',
      'weight',
      'drink_health'
    ])
    expect(keys('pet')).toEqual(['green', 'pests', 'pet_health'])
    expect(keys('baby')).toEqual(['green', 'germs', 'baby_safety'])
    expect(keys('jewelry')).toEqual(['green', 'jewelry'])
    expect(keys('accessories')).toEqual(['green', 'germs', 'toughness'])
    expect(keys('electronics')).toEqual(['green', 'germs', 'toughness'])
    expect(keys('home')).toEqual(['green', 'germs', 'pests'])
    expect(keys('apparel')).toEqual(['green', 'germs'])
    expect(keys('beauty')).toEqual(['green', 'medical_beauty'])
    expect(keys('haircare')).toEqual(['green', 'medical_beauty'])
    expect(keys('wellness')).toEqual(['green', 'health', 'weight'])
    expect(keys('kitchen')).toEqual(['green', 'germs', 'toughness'])
    expect(keys('outdoor')).toEqual(['green', 'germs', 'pests', 'toughness'])
    expect(keys('other')).toEqual(['green'])
    expect(keys(null)).toEqual(['green'])
  })

  it('reads the brand’s industry in its own words, every industry it names', () => {
    expect(claimsSafety('Detox teas').industries).toEqual(['food_drink'])
    expect(keys('Detox teas')).toContain('drink_health')
    expect(
      claimsSafety(
        'Organic cotton baby sleepwear and swaddles, gentle on sensitive skin'
      ).industries
    ).toEqual(['baby', 'skincare', 'apparel'])
    expect(keys('Pet accessories')).toEqual([
      'green',
      'germs',
      'pests',
      'pet_health',
      'toughness'
    ])
    expect(claimsSafety('Things that make dogs happy').industries).toEqual([
      'pet'
    ])
    expect(claimsSafety('Office chairs').industries).toEqual(['home'])
    expect(claimsSafety('Mineral sunscreen').industries).toEqual(['skincare'])
    expect(claimsSafety('Massage guns').industries).toEqual(['wellness'])
    expect(claimsSafety('Mystery boxes').industries).toEqual([])
    expect(keys('Natural flea and tick collars')).toContain('pests')
    expect(keys('Natural face creams and body lotions')).toContain(
      'medical_beauty'
    )
    // A word in passing brings no groups: four clothes words, one "home".
    expect(
      claimsSafety('Linen shirts, dresses, trousers and jackets for the home')
        .industries
    ).toEqual(['apparel'])
  })

  it('lists each phrase once, never one copy QA already blocks', () => {
    for (const industry of industries) {
      const phrases = claimsSafetyPhrases(industry)
      expect(new Set(phrases).size).toBe(phrases.length)
      for (const p of phrases) {
        expect(defaultBannedClaims).not.toContain(p)
        expect(p).toBe(p.toLowerCase().trim())
        expect(p.length).toBeLessThanOrEqual(120)
      }
    }
  })

  it('says why in plain words', () => {
    expect(claimReason('Clears acne', 'skincare')).toMatch(/medicine claim/)
    expect(claimReason('kills fleas', 'pet')).toMatch(/pesticide/)
    expect(claimReason('kills fleas', 'skincare')).toBeNull()
    expect(claimReason('eco-friendly', null)).toMatch(/proof/)
  })
})

describe('withClaimsSafety (ONB-062)', () => {
  it('copy QA then blocks the industry’s risky claims', () => {
    const skin = withClaimsSafety(facts, 'skincare')
    expect(
      qa('Our balm clears acne overnight.', skin).map((f) => f.excerpt)
    ).toEqual([expect.stringContaining('clears acne')])
    expect(qa('It clears eczema in a week.', skin)).toHaveLength(1)
    expect(
      qa('Our balm clears acne overnight.', withClaimsSafety(facts, 'apparel'))
    ).toEqual([])
    const tea = withClaimsSafety(facts, 'Detox teas')
    expect(qa('It boosts immunity all winter.', tea)).toHaveLength(1)
    expect(
      qa('Lose weight fast with our plan.', withClaimsSafety(facts, 'fitness'))
    ).toHaveLength(1)
  })

  it('leaves ordinary copy alone', () => {
    const everyone = [
      'Treat yourself this weekend.',
      'Our new green dress is here.',
      'A calm, sustainable routine starts here.',
      'A gift that lasts forever.'
    ]
    for (const industry of industries)
      for (const text of everyone)
        expect([
          industry,
          text,
          qa(text, withClaimsSafety(facts, industry))
        ]).toEqual([industry, text, []])
    const own: [string, string[]][] = [
      [
        'fitness',
        [
          'Ten fat-burning moves you can do at home.',
          'Burn fat and build strength with our kettlebells.'
        ]
      ],
      [
        'pet',
        [
          'New dog treats your pup will love.',
          'Calming treats anxiety-prone pups adore.'
        ]
      ],
      ['baby', ['Our silicone teether brings gentle teething relief.']],
      ['jewelry', ['Hypoallergenic, nickel-free earrings for sensitive ears.']],
      [
        'skincare',
        ['Gentle on eczema-prone skin.', 'Hypoallergenic and fragrance-free.']
      ],
      ['beauty_tools', ['Made from soft, medical-grade silicone.']]
    ]
    for (const [industry, lines] of own)
      for (const text of lines)
        expect([text, qa(text, withClaimsSafety(facts, industry))]).toEqual([
          text,
          []
        ])
  })

  it('keeps exercise copy for a fitness brand that names wellness or food too', () => {
    for (const niche of [
      'Home fitness and wellness gear',
      'Fitness equipment and recovery tools: kettlebells, dumbbells and massage balls',
      'Yoga mats, gym gear and protein snacks'
    ]) {
      const fit = withClaimsSafety(facts, niche)
      for (const text of [
        'Ten fat-burning moves you can do at home.',
        'Burn fat and build strength with our kettlebells.'
      ])
        expect([niche, text, qa(text, fit)]).toEqual([niche, text, []])
      expect(qa('Lose weight fast with our plan.', fit)).toHaveLength(1)
    }
    // A supplement brand named more than fitness keeps the weight group.
    expect(keys('Protein powders, vitamins and gym towels')).toContain('weight')
  })

  it('never reads a product’s own name as a claim', () => {
    const shop = withClaimsSafety(facts, 'accessories')
    const text = 'Meet the Eco-Friendly Tote.'
    expect(qa(text, shop, ['Eco-Friendly Tote'])).toEqual([])
    expect(qa(text, shop)).toHaveLength(1)
  })

  it('keeps the brand’s own words first and lets an approved claim through in any spelling', () => {
    const own = withClaimsSafety(
      {
        ...facts,
        bannedPhrases: ['cheap', 'Eco-friendly'],
        approvedClaims: ['Our shipping is carbon neutral', 'Non-toxic paint']
      },
      'skincare'
    )
    expect(own.bannedPhrases.slice(0, 2)).toEqual(['cheap', 'Eco-friendly'])
    expect(own.bannedPhrases).not.toContain('eco-friendly')
    expect(own.bannedPhrases).toContain('eco friendly')
    for (const released of [
      'carbon neutral',
      'carbon-neutral',
      'non-toxic',
      'nontoxic'
    ])
      expect(own.bannedPhrases).not.toContain(released)
    expect(own.bannedPhrases).toContain('clears acne')
    expect(qa('Carbon-neutral shipping on every order.', own)).toEqual([])
    expect(qa('A nontoxic finish.', own)).toEqual([])
    expect(own.approvedClaims).toEqual([
      'Our shipping is carbon neutral',
      'Non-toxic paint'
    ])
    // A dash is a hyphen too.
    const dashed = withClaimsSafety(
      { ...facts, approvedClaims: ['Eco–friendly packaging'] },
      null
    )
    expect(dashed.bannedPhrases).not.toContain('eco-friendly')
    expect(dashed.bannedPhrases).not.toContain('eco friendly')
    // Whole words only: "nontoxicity" approves nothing.
    expect(
      withClaimsSafety(
        { ...facts, approvedClaims: ['Tested for nontoxicity'] },
        null
      ).bannedPhrases
    ).toContain('nontoxic')
  })

  it('fills only what is left of the 200, never cutting the brand’s own words', () => {
    const many = Array.from({ length: 195 }, (_, i) => `word ${i}`)
    const out = withClaimsSafety(
      { ...facts, bannedPhrases: many },
      'supplements'
    )
    expect(out.bannedPhrases).toHaveLength(maxBannedPhrases)
    expect(out.bannedPhrases.slice(0, 195)).toEqual(many)
    const full = Array.from({ length: 230 }, (_, i) => `word ${i}`)
    expect(
      withClaimsSafety({ ...facts, bannedPhrases: full }, 'skincare')
        .bannedPhrases
    ).toEqual(full)
  })
})
