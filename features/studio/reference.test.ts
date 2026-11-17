import { describe, expect, it } from 'vitest'
import { copyPlan, seedVariants } from '@/features/email-build/sections'
import { blockTypes } from '@/features/blocks/catalog'
import {
  pickReference,
  referenceDna,
  sectionTone,
  type ReferenceEmail
} from './reference'

const now = Date.parse('2026-11-17T12:00:00Z')

const email = (over: Partial<ReferenceEmail> = {}): ReferenceEmail => ({
  id: 'e1',
  brand: 'Pine & Co (sample)',
  subject: 'The cedar edit',
  industry: 'home',
  emailType: 'bestsellers',
  angle: 'scarcity',
  receivedAt: '2026-11-10T09:00:00Z',
  winner: false,
  sections: [
    { blockType: 'header_logo', height: 80 },
    { blockType: 'hero_image', height: 640, styles: ['dark', 'photo_led'] },
    { blockType: 'offer_banner', height: 120, purpose: 'offer' },
    { blockType: 'product_grid_2col', height: 700 },
    { blockType: 'unsure', height: 90 },
    { blockType: 'footer', height: 200 }
  ],
  ...over
})

describe('referenceDna', () => {
  it('turns tagged sections into the Copy layout and the Art director’s reference', () => {
    const dna = referenceDna(email())
    expect(dna.layout).toEqual({
      sections: [
        'header_logo',
        'hero_image',
        'offer_banner',
        'product_grid_2col',
        'unsure',
        'footer'
      ],
      angle: 'scarcity'
    })
    expect(dna.reference).toEqual([
      { family: 'header_logo', tone: 'light', height: 80 },
      { family: 'hero_image', tone: 'dark', height: 640 },
      { family: 'offer_banner', tone: 'accent', height: 120 },
      { family: 'product_grid_2col', tone: 'light', height: 700 }
    ])
    // An unnamed part and the footer have no place in the reference.
    expect(dna.refIndex).toEqual([0, 1, 2, 3, null, null])
  })

  it('leaves out a section whose height is unknown or unreal', () => {
    const dna = referenceDna(
      email({
        sections: [
          { blockType: 'hero_image', height: null },
          { blockType: 'text', height: -5 },
          { blockType: 'text', height: Number.NaN },
          { blockType: 'product_feature', height: 410.6 }
        ]
      })
    )
    expect(dna.reference).toEqual([
      { family: 'product_feature', tone: 'light', height: 411 }
    ])
    expect(dna.refIndex).toEqual([null, null, null, 0])
  })

  it('feeds Copy mode, which follows the reference’s order', () => {
    const plan = copyPlan({
      mode: 'copy',
      industry: 'home',
      slot: { emailType: 'bestseller', angle: 'x', products: 4, offer: true },
      allowed: blockTypes,
      library: seedVariants,
      competitor: referenceDna(email()).layout
    })
    expect(plan.sections.map((s) => s.family)).toEqual([
      'header_logo',
      'hero_image',
      'offer_banner',
      'product_grid_2col',
      'footer'
    ])
  })

  it('keeps an angle out when the email has none', () => {
    expect(referenceDna(email({ angle: null })).layout).not.toHaveProperty(
      'angle'
    )
  })
})

describe('sectionTone', () => {
  it('is dark when tagged dark, accent for an offer, else its block’s tone', () => {
    expect(
      sectionTone({ blockType: 'text', height: 1, styles: ['dark'] })
    ).toBe('dark')
    expect(
      sectionTone({ blockType: 'text', height: 1, purpose: 'offer' })
    ).toBe('accent')
    expect(sectionTone({ blockType: 'announcement_bar', height: 1 })).toBe(
      'dark'
    )
    expect(sectionTone({ blockType: 'unsure', height: 1 })).toBe('light')
  })
})

describe('pickReference', () => {
  const slot = {
    industry: 'home',
    emailType: 'bestseller' as const,
    angle: 'scarcity'
  }

  it('picks the email that shares most with the slot, and says why', () => {
    const pick = pickReference(
      [
        email({ id: 'type-only', industry: 'pet' }),
        email({ id: 'both', winner: true }),
        email({ id: 'industry-only', emailType: 'sale' })
      ],
      slot,
      { mode: 'copy', now }
    )
    expect(pick.email?.id).toBe('both')
    expect(pick.reason).toBe(
      'Pine & Co (sample)’s email “The cedar edit” (2026-11-10): the same industry (home) and the same kind of email (bestseller), a layout they keep sending, the same angle.'
    )
  })

  it('prefers a winning layout, then the newest, then the id', () => {
    const pick = (emails: ReferenceEmail[]) =>
      pickReference(emails, slot, { mode: 'remix', now }).email?.id
    expect(pick([email({ id: 'a' }), email({ id: 'b', winner: true })])).toBe(
      'b'
    )
    expect(
      pick([
        email({ id: 'old', receivedAt: '2026-11-01T09:00:00Z' }),
        email({ id: 'new', receivedAt: '2026-11-12T09:00:00Z' })
      ])
    ).toBe('new')
    expect(pick([email({ id: 'b' }), email({ id: 'a' })])).toBe('a')
  })

  it('never picks an email that shares neither industry nor email type', () => {
    const pick = pickReference(
      [email({ industry: 'pet', emailType: 'sale' })],
      slot,
      { mode: 'remix', now }
    )
    expect(pick.email).toBeNull()
    expect(pick.reason).toBe(
      'No email in the Inspiration inbox is a home email or a bestseller email with a clear layout, so this email is designed from scratch.'
    )
  })

  it('needs every named section measured for Copy, not for Remix', () => {
    const unmeasured = email({
      sections: [
        { blockType: 'hero_image', height: null },
        { blockType: 'product_grid_2col', height: 700 },
        { blockType: 'footer', height: null }
      ]
    })
    expect(pickReference([unmeasured], slot, { mode: 'copy', now }).email).toBe(
      null
    )
    expect(
      pickReference([unmeasured], slot, { mode: 'copy', now }).reason
    ).toMatch(/with every section measured/)
    expect(
      pickReference([unmeasured], slot, { mode: 'remix', now }).email?.id
    ).toBe('e1')
  })

  it('skips emails too old, from the future, undated or with too few sections', () => {
    const none = (e: ReferenceEmail) =>
      pickReference([e], slot, { mode: 'remix', now }).email
    expect(none(email({ receivedAt: '2025-11-01T00:00:00Z' }))).toBeNull()
    expect(none(email({ receivedAt: '2026-12-01T00:00:00Z' }))).toBeNull()
    expect(none(email({ receivedAt: 'yesterday' }))).toBeNull()
    expect(
      none(
        email({
          sections: [
            { blockType: 'header_logo', height: 80 },
            { blockType: 'hero_image', height: 600 },
            { blockType: 'unsure', height: 100 },
            { blockType: 'footer', height: 200 }
          ]
        })
      )
    ).toBeNull()
  })

  it('counts the inbox’s own names for the same kind of email', () => {
    const offer = { ...slot, emailType: 'offer' as const }
    expect(
      pickReference(
        [email({ id: 'sale', industry: 'pet', emailType: 'sale' })],
        offer,
        { mode: 'remix', now }
      ).email?.id
    ).toBe('sale')
    expect(
      pickReference(
        [email({ industry: 'pet', emailType: 'bestsellers' })],
        offer,
        { mode: 'remix', now }
      ).email
    ).toBeNull()
    expect(
      pickReference(
        [],
        { industry: 'outdoor', emailType: 'offer' },
        {
          mode: 'remix',
          now
        }
      ).reason
    ).toMatch(
      /^No email in the Inspiration inbox is an outdoor email or an offer email/
    )
  })

  it('has no reference in Scratch mode', () => {
    expect(pickReference([email()], slot, { mode: 'scratch', now })).toEqual({
      email: null,
      reason: 'Scratch emails have no reference.'
    })
  })
})
