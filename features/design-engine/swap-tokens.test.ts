import { describe, expect, it } from 'vitest'
import {
  partsOf,
  type Blueprint,
  type ButtonPart,
  type Column,
  type ImagePart,
  type RowItem
} from './blueprint'
import { blueprint, button, gridSection, image, section } from './fixtures'
import { swapBrand, type SwapInput } from './swap'
import { resolveTokens } from './tokens'
import {
  testBrand,
  testCropper,
  testProducts,
  testRules,
  testWords
} from './golden/brand'

/**
 * PICK-006: the brand's design tokens in a library copy (Copy and
 * Scratch go through the same swap): its button corners and look, picture
 * and card corners, only from values its site or owner gave; never on an
 * own design; the structure (sizes, places) as it was.
 */

const calm = resolveTokens({
  site: {
    'radius.button': 0,
    'radius.card': 4,
    'radius.image': 2,
    'button.style': 'filled',
    'button.case': 'uppercase',
    'button.weight': 600
  }
})
const soft = resolveTokens({
  site: {
    'radius.button': 24,
    'radius.card': 16,
    'radius.image': 12,
    'button.style': 'outline',
    'button.weight': 500
  }
})

const source = (): Blueprint =>
  blueprint({
    sections: [
      section({
        items: [
          image({ x: 0, width: 600, height: 300, role: 'hero_photo' }),
          image({ x: 150, width: 300, height: 300, role: 'photo' }),
          button({ radius: 4 })
        ]
      }),
      gridSection(2)
    ]
  })

const run = (over: Partial<SwapInput> = {}) => {
  const got = swapBrand({
    source: source(),
    brand: testBrand,
    products: testProducts,
    words: testWords,
    rules: testRules,
    cropper: testCropper,
    ...over
  })
  if (!got.ok) throw new Error(got.error)
  return got
}

const parts = (bp: Blueprint) => bp.sections.flatMap((s) => partsOf(s.items))
const buttons = (bp: Blueprint) =>
  parts(bp).filter((p): p is ButtonPart => p.type === 'button')
const pictures = (bp: Blueprint) =>
  parts(bp).filter((p): p is ImagePart => p.type === 'image')
const columns = (bp: Blueprint): Column[] =>
  bp.sections.flatMap((s) =>
    s.items.flatMap((i) => (i.type === 'row' ? (i as RowItem).columns : []))
  )

describe('brand swap with design tokens (PICK-006)', () => {
  it('draws the same layout differently for two brands’ tokens', () => {
    const a = run({ brand: { ...testBrand, tokens: calm } }).target
    const b = run({ brand: { ...testBrand, tokens: soft } }).target
    const [ba] = buttons(a)
    const [bb] = buttons(b)
    expect(ba!.radius).toBe(0)
    expect(ba!.background).not.toBeNull()
    expect(ba!.font.transform).toBe('uppercase')
    expect(ba!.font.weight).toBe(600)
    // An outline: no fill, a line in the brand's button colour, a pill.
    expect(bb!.background).toBeNull()
    expect(bb!.border?.width).toBe(2)
    expect(bb!.border?.color).toBe(ba!.background)
    expect(bb!.radius).toBe(24)
    expect(bb!.font.weight).toBe(500)
    // The structure stays: the button's box and place.
    for (const btn of [ba!, bb!]) {
      expect([btn.x, btn.width, btn.height]).toEqual([220, 160, 48])
    }
    // Pictures: the full-width one keeps its own corners, the others the brand's.
    const [heroA, photoA] = pictures(a)
    const [heroB, photoB] = pictures(b)
    expect(heroA!.radius).toBe(0)
    expect(heroB!.radius).toBe(0)
    expect(photoA!.radius).toBe(2)
    expect(photoB!.radius).toBe(12)
    // Cards: a column with a fill takes the card corners; one without stays.
    const [plainA, cardA] = columns(a)
    const [, cardB] = columns(b)
    expect(plainA!.radius).toBe(0)
    expect(cardA!.radius).toBe(4)
    expect(cardB!.radius).toBe(16)
    // The section-built-from-a-block brand carries the tokens too.
    expect(
      run({ brand: { ...testBrand, tokens: soft } }).blockBrand.tokens?.[
        'button.style'
      ]
    ).toBe('outline')
  })

  it('keeps the layout’s own look for tokens the site did not give', () => {
    const plain = run().target
    const defaults = run({
      brand: { ...testBrand, tokens: resolveTokens({}) }
    }).target
    expect(defaults).toEqual(plain)
  })

  it('never changes an own design’s look', () => {
    const own = run({ keepLook: true }).target
    const ownWithTokens = run({
      keepLook: true,
      brand: { ...testBrand, tokens: soft }
    }).target
    expect(ownWithTokens).toEqual(own)
    expect(
      run({ keepLook: true, brand: { ...testBrand, tokens: soft } }).blockBrand
        .tokens
    ).toBeUndefined()
  })

  it('makes an outline button filled for a filled brand', () => {
    const got = swapBrand({
      source: blueprint({
        sections: [
          section({
            items: [
              button({
                background: null,
                border: { width: 1, color: '#222222' },
                color: '#222222'
              })
            ]
          })
        ]
      }),
      brand: { ...testBrand, tokens: calm },
      products: testProducts,
      words: testWords,
      rules: testRules
    })
    if (!got.ok) throw new Error(got.error)
    const [b] = buttons(got.target)
    expect(b!.background).not.toBeNull()
    expect(b!.border).toBeNull()
  })
})
