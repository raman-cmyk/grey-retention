import { describe, expect, it } from 'vitest'
import type { BlockFacts } from '@/features/design-engine/blocks'
import { blueprint, section } from '@/features/design-engine/fixtures'
import {
  composeScratch,
  misfit,
  planScratch,
  scratchOrder,
  type LibraryBlock,
  type ScratchInput
} from './scratch'

const facts = (over: Partial<BlockFacts> = {}): BlockFacts => ({
  width: 600,
  height: 300,
  columns: 1,
  photos: [],
  products: 0,
  texts: 1,
  buttons: 0,
  headline: false,
  logo: false,
  icons: 0,
  prices: false,
  oldPrice: false,
  code: false,
  footer: false,
  band: false,
  ...over
})
let n = 0
const block = (
  kind: LibraryBlock['kind'],
  over: Partial<LibraryBlock> = {},
  f: Partial<BlockFacts> = {}
): LibraryBlock => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  kind,
  facts: facts(f),
  width: 600,
  uses: 1,
  brands: 1,
  emailTypes: [],
  yours: false,
  ...over
})

const input = (over: Partial<ScratchInput> = {}): ScratchInput => ({
  emailType: 'launch',
  products: 3,
  productPhotos: 3,
  offer: false,
  logo: true,
  photos: 1,
  recent: new Set(),
  seed: 'build-1',
  ...over
})

const library = () => [
  block('header', { uses: 28 }, { logo: true, height: 80 }),
  block(
    'hero',
    { uses: 3 },
    {
      headline: true,
      photos: [{ role: 'hero_photo', width: 600, height: 300 }]
    }
  ),
  block('hero', { uses: 9 }, { headline: false }),
  block('text', {}, { texts: 2 }),
  block(
    'product_grid',
    { uses: 4 },
    {
      products: 2,
      prices: true,
      photos: [
        { role: 'product_photo', width: 260, height: 260 },
        { role: 'product_photo', width: 260, height: 260 }
      ]
    }
  ),
  block('button', {}, { buttons: 1, height: 90 }),
  block('footer', { uses: 30 }, { footer: true, height: 120 }),
  block('offer', { uses: 50 }, { code: true, headline: true }),
  block('footer', { uses: 99 }, { footer: false })
]

describe('Scratch from the block library (DES-ENGINE-004b)', () => {
  it('plans a launch in its running order, the main section with the headline', () => {
    const plan = planScratch(library(), input())
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.blocks.map((b) => b.kind)).toEqual([
      'header',
      'hero',
      'text',
      'product_grid',
      'button',
      'footer'
    ])
    // A hero used less but with a headline wins the main section.
    expect(plan.blocks[1]!.facts.headline).toBe(true)
    // A footer without the unsubscribe line is never the footer.
    expect(plan.blocks.at(-1)!.facts.footer).toBe(true)
    expect(plan.why[0]).toMatch(/used 28 times/)
  })

  it('uses only what the brand can fill: no code without an offer, no logo, products and photos it has', () => {
    const offer = block('offer', {}, { code: true })
    expect(
      misfit(
        offer,
        { products: 3, productPhotos: 3, photos: 1 },
        { offer: false, logo: true }
      )
    ).toMatch(/code/)
    expect(
      misfit(
        offer,
        { products: 3, productPhotos: 3, photos: 1 },
        { offer: true, logo: true }
      )
    ).toBeNull()
    expect(
      misfit(
        block('header', {}, { logo: true }),
        { products: 0, productPhotos: 0, photos: 0 },
        { offer: false, logo: false }
      )
    ).toMatch(/logo/)
    expect(
      misfit(
        block('product_grid', {}, { products: 3 }),
        { products: 2, productPhotos: 2, photos: 0 },
        { offer: false, logo: true }
      )
    ).toMatch(/more products/)
    expect(
      misfit(
        block(
          'hero',
          {},
          { photos: [{ role: 'photo', width: 600, height: 300 }] }
        ),
        { products: 0, productPhotos: 0, photos: 0 },
        { offer: false, logo: true }
      )
    ).toMatch(/photos/)
    expect(
      misfit(
        block('hero', {}, { oldPrice: true }),
        { products: 3, productPhotos: 3, photos: 1 },
        { offer: true, logo: true }
      )
    ).toMatch(/old price/)
    expect(
      misfit(
        block('hero', {}, { icons: 2 }),
        { products: 3, productPhotos: 3, photos: 1 },
        { offer: true, logo: true }
      )
    ).toMatch(/icons/)
    expect(
      misfit(
        block('hero', { width: 640 }),
        { products: 3, productPhotos: 3, photos: 1 },
        { offer: true, logo: true }
      )
    ).toMatch(/width/)
    // An offer email takes the offer block; one without an offer never does.
    const withOffer = planScratch(
      library(),
      input({ emailType: 'offer', offer: true })
    )
    expect(withOffer.ok && withOffer.blocks[1]!.kind).toBe('offer')
    const without = planScratch(library(), input({ emailType: 'offer' }))
    expect(without.ok && without.blocks.some((b) => b.facts.code)).toBe(false)
  })

  it('an email with no products gets no product grid', () => {
    const plan = planScratch(
      library(),
      input({ products: 0, productPhotos: 0 })
    )
    expect(plan.ok && plan.blocks.some((b) => b.kind === 'product_grid')).toBe(
      false
    )
  })

  it('ranks layouts used a lot, and of the same type, higher; lowers recent picks (variety)', () => {
    const quiet = block('text', { uses: 1 })
    const loud = block('text', { uses: 10, brands: 3 })
    const typed = block('text', { uses: 1, emailTypes: ['launch'] })
    const lib = [
      ...library().filter((b) => b.kind !== 'text'),
      quiet,
      loud,
      typed
    ]
    const first = planScratch(lib, input())
    expect(first.ok && first.blocks[2]!.id).toBe(loud.id)
    const again = planScratch(lib, input({ recent: new Set([loud.id]) }))
    expect(again.ok && again.blocks[2]!.id).not.toBe(loud.id)
  })

  it('says why when the library cannot build the email', () => {
    const plan = planScratch([block('footer', {}, { footer: true })], input())
    expect(plan).toEqual({
      ok: false,
      reason: expect.stringMatching(/no hero layout your brand can fill/)
    })
    expect(planScratch([], input({ emailType: 'education' })).ok).toBe(false)
  })

  it('has a running order for every email type', () => {
    for (const order of Object.values(scratchOrder)) {
      expect(order.filter((s) => s.lead)).toHaveLength(1)
      expect(order.at(-1)!.kinds).toEqual(['footer'])
    }
  })

  it('composes the picked blocks into one email, numbered in order, a dark email’s block keeping its band', () => {
    const light = blueprint({ sections: [section({ ordinal: 1 })] })
    const dark = blueprint({
      body: '#111111',
      sections: [section({ ordinal: 1, kind: 'text', background: null })]
    })
    const email = composeScratch([light, dark, light])
    expect(email.sections.map((s) => s.ordinal)).toEqual([1, 2, 3])
    expect(email.sections.every((s) => s.gapBefore === 0)).toBe(true)
    expect(email.body).toBe('#ffffff')
    expect(email.sections[1]!.background).toBe('#111111')
    expect(email.sections[0]!.background).toBeNull()
  })
})
