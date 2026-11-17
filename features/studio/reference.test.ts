import { describe, expect, it } from 'vitest'
import { blockTypes } from '@/features/blocks/catalog'
import { copyPlan, seedVariants } from '@/features/email-build/sections'
import {
  pickReference,
  referenceDna,
  sectionTone,
  type ReferenceEmail
} from './reference'
import {
  codeStoryboard,
  copyKeepable,
  storyboardProblems,
  type StoryboardInput
} from './storyboard'

const now = Date.parse('2026-11-17T12:00:00Z')
const followed = new Set(['pine'])

const email = (over: Partial<ReferenceEmail> = {}): ReferenceEmail => ({
  id: 'e1',
  brandId: 'pine',
  brand: 'Pine & Co',
  synthetic: false,
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

const slot = { industry: 'home', emailType: 'bestseller' as const }
const pick = (
  emails: ReferenceEmail[],
  mode: 'copy' | 'remix' = 'remix',
  s: Parameters<typeof pickReference>[1] = slot
) => pickReference(emails, s, { mode, now, followed })

/** Copy all the way: the reference, the plan, code's storyboard. */
function copyStoryboard(e: ReferenceEmail) {
  const dna = referenceDna(e)
  const plan = copyPlan({
    mode: 'copy',
    industry: 'home',
    slot: { emailType: 'bestseller', angle: 'x', products: 4, offer: true },
    allowed: blockTypes,
    library: seedVariants,
    competitor: dna.layout
  })
  const input: StoryboardInput = {
    mode: 'copy',
    slot: { emailType: 'bestseller', angle: 'x' },
    sections: plan.sections.map((s, i) => {
      const ref = s.source === undefined ? null : dna.refIndex[s.source]
      return {
        id: `s${i + 1}`,
        family: s.family,
        purpose: s.purpose,
        products: s.family.startsWith('product_grid') ? 2 : 0,
        ...(ref === null ? {} : { ref })
      }
    }),
    reference: dna.reference
  }
  return { plan, input, board: codeStoryboard(input) }
}

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
          { blockType: 'text', height: 4_001 },
          { blockType: 'product_feature', height: 410.6 },
          { blockType: 'text', height: 4_000 }
        ]
      })
    )
    expect(dna.reference).toEqual([
      { family: 'product_feature', tone: 'light', height: 411 },
      { family: 'text', tone: 'light', height: 4_000 }
    ])
    expect(dna.refIndex).toEqual([null, null, null, null, 0, 1])
  })

  it('keeps at most 40 sections', () => {
    const dna = referenceDna(
      email({
        sections: Array.from({ length: 45 }, () => ({
          blockType: 'text',
          height: 100
        }))
      })
    )
    expect(dna.layout.sections).toHaveLength(40)
    expect(dna.refIndex).toHaveLength(40)
  })

  it('makes a dark hero after a dark section stand out as accent, and live sections keep their own tone', () => {
    const dna = referenceDna(
      email({
        sections: [
          { blockType: 'announcement_bar', height: 40 },
          { blockType: 'hero_image', height: 600, styles: ['dark'] },
          { blockType: 'text', height: 200, styles: ['dark'] }
        ]
      })
    )
    expect(dna.reference.map((r) => r.tone)).toEqual([
      'dark',
      'accent',
      'light'
    ])
  })

  it('feeds Copy all the way to a storyboard code can draw', () => {
    const { plan, input, board } = copyStoryboard(email())
    expect(plan.sections.map((s) => s.family)).toEqual([
      'header_logo',
      'hero_image',
      'offer_banner',
      'product_grid_2col',
      'footer'
    ])
    // Each planned section knows its place in the competitor's email.
    expect(plan.sections.map((s) => s.source)).toEqual([0, 1, 2, 3, undefined])
    expect(board).not.toBeNull()
    expect(storyboardProblems(board!, input)).toEqual([])
    const hero = board!.sections.find((s) => s.render === 'designed')!
    expect(hero.tone).toBe('dark')
    expect(Math.abs(hero.height - 640)).toBeLessThanOrEqual(160)
  })

  it('keeps Copy drawable when an announcement bar sits on a dark hero, and the header is added', () => {
    const { board, input } = copyStoryboard(
      email({
        sections: [
          { blockType: 'announcement_bar', height: 40 },
          { blockType: 'hero_image', height: 160, styles: ['dark'] },
          { blockType: 'product_grid_2col', height: 700 }
        ]
      })
    )
    expect(board).not.toBeNull()
    expect(storyboardProblems(board!, input)).toEqual([])
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
  it('picks the email that shares most with the slot, and says why', () => {
    const p = pick(
      [
        email({ id: 'type-only', industry: 'pet' }),
        email({ id: 'both', winner: true }),
        email({ id: 'industry-only', emailType: 'sale' })
      ],
      'copy'
    )
    expect(p.email?.id).toBe('both')
    expect(p.reason).toBe(
      'We copy Pine & Co’s email “The cedar edit” (10 Nov 2026). It is the same industry (home) and the same kind of email, and a layout they send again and again.'
    )
  })

  it('ranks both labels over one, even against a recent winning layout', () => {
    expect(
      pick([
        email({ id: 'both-old', receivedAt: '2026-08-01T09:00:00Z' }),
        email({
          id: 'type-winner-new',
          industry: 'pet',
          winner: true,
          receivedAt: '2026-11-16T09:00:00Z'
        })
      ]).email?.id
    ).toBe('both-old')
  })

  it('then prefers a winning layout, then a recent one, the newest, then the id', () => {
    const id = (emails: ReferenceEmail[]) => pick(emails).email?.id
    expect(id([email({ id: 'a' }), email({ id: 'b', winner: true })])).toBe('b')
    expect(
      id([
        email({ id: 'old', receivedAt: '2026-11-01T09:00:00Z' }),
        email({ id: 'new', receivedAt: '2026-11-12T09:00:00Z' })
      ])
    ).toBe('new')
    expect(id([email({ id: 'b' }), email({ id: 'a' })])).toBe('a')
  })

  it('says only what it shares', () => {
    expect(pick([email({ industry: 'pet' })]).reason).toBe(
      'We remix Pine & Co’s email “The cedar edit” (10 Nov 2026). It is the same kind of email.'
    )
    expect(pick([email({ emailType: 'story' })]).reason).toMatch(
      /It is the same industry \(home\)\.$/
    )
  })

  it('offers only the brands the workspace follows, or sample brands', () => {
    const stranger = email({ id: 'x', brandId: 'someone-else' })
    expect(pick([stranger]).email).toBeNull()
    expect(pick([stranger]).reason).toBe(
      'No email from the brands you follow is in the Inspiration inbox yet, so this email is designed from scratch.'
    )
    expect(pick([{ ...stranger, synthetic: true }]).email?.id).toBe('x')
  })

  it('never picks an email that shares neither label; "other" or no industry is no match', () => {
    const p = pick([email({ industry: 'pet', emailType: 'sale' })])
    expect(p.email).toBeNull()
    expect(p.reason).toBe(
      'None of the emails from the brands you follow is a home email or the same kind of email (bestseller), so this email is designed from scratch.'
    )
    const other = { industry: 'other', emailType: 'story' as const }
    expect(pick([email({ industry: 'other' })], 'remix', other).email).toBe(
      null
    )
    expect(pick([email({ industry: 'other' })], 'remix', other).reason).toBe(
      'None of the emails from the brands you follow is the same kind of email (story), so this email is designed from scratch.'
    )
    expect(
      pick([email()], 'remix', { industry: null, emailType: 'story' }).email
    ).toBeNull()
  })

  it('counts the inbox’s own names for the same kind of email', () => {
    const offer = { industry: 'outdoor', emailType: 'offer' as const }
    expect(
      pick([email({ id: 'sale', emailType: 'sale' })], 'remix', offer).email?.id
    ).toBe('sale')
    expect(pick([email()], 'remix', offer).reason).toMatch(
      /^None of the emails from the brands you follow is an outdoor email or/
    )
  })

  it('needs every top picture keepable for Copy, not for Remix', () => {
    const at = (height: number | null) =>
      email({
        sections: [
          { blockType: 'header_logo', height: null },
          { blockType: 'hero_image', height },
          { blockType: 'product_grid_2col', height: null }
        ]
      })
    expect(pick([at(copyKeepable.min)], 'copy').email).not.toBeNull()
    expect(pick([at(copyKeepable.max)], 'copy').email).not.toBeNull()
    for (const h of [null, copyKeepable.min - 1, copyKeepable.max + 1]) {
      expect(pick([at(h)], 'copy').email).toBeNull()
      expect(pick([at(h)], 'remix').email).not.toBeNull()
    }
    expect(pick([at(null)], 'copy').reason).toBe(
      'The emails from the brands you follow that are a home email or the same kind of email (bestseller) cannot be followed: their top pictures are too short or too tall to copy, so this email is designed from scratch.'
    )
  })

  it('skips emails too old, undated, from the future or with too few sections, and says why', () => {
    const none = (e: ReferenceEmail) => pick([e]).email
    expect(none(email({ receivedAt: '2025-11-01T00:00:00Z' }))).toBeNull()
    expect(
      pick([email({ receivedAt: '2025-11-01T00:00:00Z' })]).reason
    ).toMatch(/cannot be followed: they are more than a year old/)
    expect(none(email({ receivedAt: '2026-12-01T00:00:00Z' }))).toBeNull()
    expect(none(email({ receivedAt: 'yesterday' }))).toBeNull()
    // A few minutes ahead of this clock still counts.
    expect(none(email({ receivedAt: '2026-11-17T12:03:00Z' }))).not.toBeNull()
    const thin = email({
      sections: [
        { blockType: 'header_logo', height: 80 },
        { blockType: 'hero_image', height: 600 },
        { blockType: 'unsure', height: 100 },
        { blockType: 'footer', height: 200 }
      ]
    })
    expect(none(thin)).toBeNull()
    expect(pick([thin]).reason).toMatch(/their layouts are too short to follow/)
  })

  it('keeps an untrusted subject and brand to one short line', () => {
    const p = pick([
      email({ subject: `Big\nnews ${'x'.repeat(200)}`, brand: 'Pine\t&\nCo' })
    ])
    expect(p.reason).toMatch(/^We remix Pine & Co’s email “Big news x+”/)
    expect(p.reason).not.toMatch(/\n/)
    expect(p.reason.match(/“(.*)”/)![1]).toHaveLength(80)
  })

  it('has no reference in Scratch mode', () => {
    expect(
      pickReference([email()], slot, { mode: 'scratch', now, followed })
    ).toEqual({ email: null, reason: 'Scratch emails have no reference.' })
  })
})
