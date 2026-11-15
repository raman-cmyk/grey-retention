import { describe, expect, it } from 'vitest'
import {
  checkCopy,
  defaultBannedClaims,
  type BrandFacts
} from '@/features/copy-qa/check'
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
const qa = (text: string, f: BrandFacts) =>
  checkCopy({
    draft: {
      subject: 'New this week',
      preview: 'Take a look',
      blocks: [{ id: 'b1', text }]
    },
    facts: f,
    maxDiscountPercent: null,
    codes: [],
    productNames: ['Detox Green Tea'],
    sendAt: '2026-11-20T15:00:00.000Z'
  }).failures.filter((x) => x.rule === 'banned_phrase')

describe('claimsSafety (ONB-062)', () => {
  it('gives each industry its own groups, and every brand the green words', () => {
    expect(keys('skincare')).toEqual(['green', 'medical_beauty'])
    expect(keys('supplements')).toEqual(['green', 'health', 'weight'])
    expect(keys('pet')).toEqual(['green', 'pests', 'pet_health'])
    expect(keys('baby')).toEqual(['green', 'germs', 'baby_safety'])
    expect(keys('food_drink')).toEqual([
      'green',
      'health',
      'weight',
      'drink_health'
    ])
    expect(keys('jewelry')).toEqual(['green', 'jewelry'])
    expect(keys('other')).toEqual(['green'])
    expect(keys(null)).toEqual(['green'])
    expect(claimsSafety('  ').industry).toBeNull()
  })

  it('reads the brand’s industry in its own words', () => {
    expect(claimsSafety('Vitamin C serums for dry skin').industry).toBe(
      'skincare'
    )
    expect(claimsSafety('Dog treats and toys').industry).toBe('pet')
    expect(claimsSafety('CBD gummies').industry).toBe('wellness')
    expect(claimsSafety('BEAUTY_TOOLS').industry).toBe('beauty_tools')
    expect(claimsSafety('Mystery boxes').industry).toBe('other')
  })

  it('lists each phrase once, never one copy QA already blocks', () => {
    for (const industry of ['skincare', 'supplements', 'baby', 'accessories']) {
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
    expect(qa('Gentle on eczema-prone skin.', skin)).toHaveLength(1)
    expect(
      qa('Our balm clears acne overnight.', withClaimsSafety(facts, 'apparel'))
    ).toEqual([])
    const tea = withClaimsSafety(facts, 'food_drink')
    expect(qa('It boosts immunity all winter.', tea)).toHaveLength(1)
  })

  it('leaves ordinary copy alone', () => {
    const pet = withClaimsSafety(facts, 'pet')
    const food = withClaimsSafety(facts, 'food_drink')
    for (const text of [
      'Treat yourself this weekend.',
      'New dog treats your pup will love.',
      'Our new green dress is here.',
      'A calm, sustainable routine starts here.'
    ]) {
      expect(qa(text, pet)).toEqual([])
      expect(qa(text, food)).toEqual([])
    }
    // A product's own name is not read as a claim.
    expect(
      qa('Meet the Detox Green Tea.', withClaimsSafety(facts, 'supplements'))
    ).toEqual([])
  })

  it('keeps the brand’s own words first and lets an approved claim through', () => {
    const own = withClaimsSafety(
      {
        ...facts,
        bannedPhrases: ['cheap', 'Eco-friendly'],
        approvedClaims: ['Certified carbon neutral since 2024']
      },
      'skincare'
    )
    expect(own.bannedPhrases.slice(0, 2)).toEqual(['cheap', 'Eco-friendly'])
    expect(own.bannedPhrases).not.toContain('eco-friendly')
    expect(own.bannedPhrases).not.toContain('carbon neutral')
    expect(own.bannedPhrases).toContain('carbon-neutral')
    expect(own.bannedPhrases).toContain('clears acne')
    expect(own.approvedClaims).toEqual(['Certified carbon neutral since 2024'])
    // Whole words only: "non-toxic" is not inside an approved "nontoxicity".
    expect(
      withClaimsSafety(
        { ...facts, approvedClaims: ['Tested for nontoxicity'] },
        null
      ).bannedPhrases
    ).toContain('nontoxic')
  })

  it('stays within copy QA’s limit of 200', () => {
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
    ).toEqual(full.slice(0, maxBannedPhrases))
  })
})
