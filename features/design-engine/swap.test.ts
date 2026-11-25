import { describe, expect, it } from 'vitest'
import { contrast } from '@/features/blocks/brand'
import {
  blueprintSchema,
  partsOf,
  textOf,
  type Blueprint,
  type ImagePart,
  type Section,
  type TextPart
} from './blueprint'
import { blueprint, button, font, image, section, text } from './fixtures'
import { drawBlueprint } from './render'
import { forStorage } from './stored'
import { swapBrand, swapOwnWords, type SwapInput } from './swap'
import { leaksOf } from './leaks'
import {
  testBrand,
  testCropper,
  testProducts,
  testRules,
  testVocabulary,
  testWords
} from './golden/brand'

const input = (
  source: Blueprint,
  over: Partial<SwapInput> = {}
): SwapInput => ({
  source,
  brand: testBrand,
  products: testProducts,
  words: testWords,
  rules: testRules,
  cropper: testCropper,
  ...over
})

const swapped = (source: Blueprint, over: Partial<SwapInput> = {}) => {
  const got = swapBrand(input(source, over))
  if (!got.ok) throw new Error(got.error)
  return got
}

const header = (): Section =>
  section({
    ordinal: 1,
    kind: 'header',
    height: 88,
    items: [
      image({
        gapBefore: 24,
        x: 225,
        width: 150,
        height: 40,
        role: 'logo',
        alt: 'Rival Store'
      })
    ],
    bottom: 24
  })

const footer = (ordinal: number): Section =>
  section({
    ordinal,
    kind: 'footer',
    height: 110,
    background: '#f6f6f6',
    items: [
      text({
        role: 'legal',
        lines: 3,
        height: 54,
        font: { ...font, size: 12, lineHeight: 18 },
        color: '#777777',
        runs: [
          { text: 'Rival Store, 9 Rival Road' },
          { text: '\n' },
          { text: 'You signed up at rival.example.' },
          { text: '\n' },
          {
            text: 'Unsubscribe',
            underline: true,
            href: 'https://rival.example/u'
          }
        ]
      })
    ],
    bottom: 28
  })

const email = () =>
  blueprint({
    sections: [
      header(),
      { ...section(), ordinal: 2 },
      {
        ...blueprint().sections[1]!,
        ordinal: 3
      },
      footer(4)
    ]
  })

describe('brand swap', () => {
  it('keeps every section, part, size, gap and place of the source', () => {
    const source = email()
    const { target } = swapped(source)
    expect(blueprintSchema.safeParse(target).success).toBe(true)
    const geometry = (bp: Blueprint) =>
      JSON.stringify(bp, (k, v) =>
        [
          'runs',
          'label',
          'src',
          'alt',
          'href',
          'color',
          'background',
          'around',
          'page',
          'body',
          'family',
          'border',
          'radius'
        ].includes(k)
          ? undefined
          : v
      )
    // The logo alone takes the brand logo's own width (and its place).
    const noLogo = (bp: Blueprint): Blueprint => ({
      ...bp,
      sections: bp.sections.filter((s) => s.ordinal !== 1)
    })
    expect(geometry(noLogo(target))).toBe(geometry(noLogo(source)))
  })

  it('takes nothing a reader sees from the source', () => {
    const source = email()
    const got = swapped(source)
    const html = drawBlueprint(got.target, { brand: got.blockBrand })
    expect(
      leaksOf({
        source,
        html,
        sourceNames: ['Rival Store', 'rival.example'],
        vocabulary: [...testVocabulary, ...swapOwnWords(testBrand)]
      })
    ).toEqual([])
    expect(html).not.toContain('example.com')
  })

  it('draws the brand logo at the original height, never stretched, in the same place', () => {
    const logo = partsOf(
      swapped(email()).target.sections[0]!.items
    )[0] as ImagePart
    expect(logo.height).toBe(40)
    expect(logo.width).toBe(120) // 180 × 60 at 40 px tall
    expect(logo.x).toBe(240) // still centred in 600
    expect(logo.src).toBe(testBrand.logo!.src)
    expect(logo.href).toBe(testBrand.site)
  })

  it('a logo wider than the original box is fitted inside it', () => {
    const wide = {
      ...testBrand,
      logo: { ...testBrand.logo!, width: 600, height: 60 }
    }
    const logo = partsOf(
      swapped(email(), { brand: wide }).target.sections[0]!.items
    )[0] as ImagePart
    expect(logo.width).toBe(150)
    expect(logo.height).toBe(15)
  })

  it('without a logo the header is built from a library block, with the reason', () => {
    const got = swapped(email(), { brand: { ...testBrand, logo: null } })
    expect(got.blocked.get(1)).toBe(
      'has a logo, and the Brand kit has no logo picture'
    )
  })

  it('puts products in plan order with their own photos, titles, prices and links', () => {
    const grid = swapped(email()).target.sections[2]!
    const row = grid.items[0]!
    if (row.type !== 'row') throw new Error('row')
    const cols = row.columns.map((c) => partsOf(c.items))
    expect((cols[0]![1] as TextPart).runs.map((r) => r.text).join('')).toBe(
      '$14.00'
    )
    expect((cols[1]![1] as TextPart).runs.map((r) => r.text).join('')).toBe(
      '$16.00'
    )
    expect((cols[0]![0] as ImagePart).href).toBe(testProducts[0]!.url)
    expect((cols[0]![0] as ImagePart).alt).toBe('Hill green')
  })

  it('without a cropper, a photo of another shape blocks its section and says why', () => {
    const got = swapped(email(), { cropper: null })
    // The hero is 2:1 and the brand has a 1200 × 600 photo: it fits.
    expect(got.blocked.has(2)).toBe(false)
    const tall = swapped(
      blueprint({
        sections: [
          section({
            items: [image({ width: 300, height: 500, x: 150 })]
          })
        ]
      }),
      { cropper: null }
    )
    expect(tall.blocked.get(1)).toBe(
      'has a tall picture, and the brand has no photo of that shape'
    )
    // The block still gets the brand's closest photo, never the source's.
    const pic = partsOf(tall.target.sections[0]!.items)[0] as ImagePart
    expect(pic.src?.startsWith('data:image/png')).toBe(true)
  })

  it('writes the footer from the brand with Klaviyo tags, and draws them in Klaviyo mode', () => {
    const got = swapped(email())
    const legal = partsOf(got.target.sections[3]!.items)[0] as TextPart
    expect(legal.runs.filter((r) => r.tag).map((r) => r.tag)).toEqual([
      'organization',
      'address',
      'unsubscribe',
      'preferences'
    ])
    expect(textOf(legal).split('\n')).toHaveLength(3)
    // Klaviyo takes only uploaded (https) pictures.
    const uploaded = JSON.parse(
      JSON.stringify(got.target).replace(
        /data:image[^"]*/g,
        'https://cdn.fernhill.example/p.png'
      )
    ) as Blueprint
    const klaviyo = drawBlueprint(uploaded, {
      mode: 'klaviyo',
      brand: got.blockBrand
    })
    expect(klaviyo).toContain('{% unsubscribe "Unsubscribe" %}')
    expect(klaviyo).toContain('{{ organization.name }}')
  })

  it('colours are the brand palette and every text reads on its fill', () => {
    const got = swapped(email())
    const t = got.target
    expect(t.page).toBe(testBrand.background)
    const hero = t.sections[1]!
    const headline = partsOf(hero.items).find(
      (p): p is TextPart => p.type === 'text'
    )!
    expect(contrast(headline.color, t.body)).toBeGreaterThanOrEqual(3)
    const cta = partsOf(hero.items).find((p) => p.type === 'button')!
    if (cta.type !== 'button') throw new Error('button')
    expect(cta.background).toBe(testBrand.accent)
    expect(contrast(cta.color, cta.background!)).toBeGreaterThanOrEqual(4.5)
    // A filled footer band stays a band (never the same as around it).
    expect(t.sections[3]!.background).not.toBe(t.sections[3]!.around)
    expect(headline.font.family).toBe('Fraunces')
  })

  it('never states a discount the email does not give, or a code it does not have', () => {
    const offer = blueprint({
      sections: [
        section({
          kind: 'offer',
          items: [
            text({
              role: 'headline',
              runs: [{ text: 'Big sale now' }],
              lines: 1
            }),
            text({
              role: 'code',
              runs: [{ text: 'Use code RIVAL40' }],
              lines: 1
            }),
            button()
          ]
        })
      ]
    })
    const none = swapped(offer, {
      rules: { offer: null, maxDiscountPercent: 20 }
    })
    expect(none.blocked.get(1)).toBe(
      'shows a discount code, and this email has none'
    )
    const words = JSON.stringify(none.target)
    expect(words).not.toMatch(/\d+\s?%/)
    const own = swapped(offer)
    expect(JSON.stringify(own.target)).toContain('Use code FERN15')
    expect(JSON.stringify(own.target)).not.toContain('RIVAL40')
  })

  it('a stored source (no pictures, no links) swaps the same', () => {
    const source = email()
    expect(JSON.stringify(swapped(forStorage(source)).target)).toBe(
      JSON.stringify(swapped(source).target)
    )
  })

  it('an old price shows only a confirmed sale price', () => {
    const card = blueprint({
      sections: [
        section({
          items: [
            text({
              role: 'price',
              runs: [{ text: '$60.00', strike: true }, { text: ' $48.00' }],
              lines: 1
            })
          ]
        })
      ]
    })
    const priced = partsOf(
      swapped(card).target.sections[0]!.items
    )[0] as TextPart
    expect(priced.runs.map((r) => [r.text, !!r.strike])).toEqual([
      ['$18.00', true],
      [' $14.00', false]
    ])
    const plain = partsOf(
      swapped(card, { products: [{ ...testProducts[1]! }] }).target.sections[0]!
        .items
    )[0] as TextPart
    expect(textOf(plain)).toBe('$16.00')
  })

  it('button words come from the brand and fit the original button', () => {
    const b = partsOf(swapped(email()).target.sections[1]!.items).find(
      (p) => p.type === 'button'
    )!
    if (b.type !== 'button') throw new Error('button')
    expect(b.label.length).toBeLessThanOrEqual('Shop now'.length + 2)
    expect(testWords.button).toContain(b.label)
    expect(button().label).toBe('Shop now')
  })
})
