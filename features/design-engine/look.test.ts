// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { blueprint, button, image, section, text } from './fixtures'
import { lookProblems } from './look'
import { swapBrand } from './swap'
import { testBrand, testProducts, testRules, testWords } from './golden/brand'

/** DES-ENGINE-003b: an own design's look kept, and the keepLook swap. */
const own = () =>
  blueprint({
    page: '#f4efe6',
    body: '#ffffff',
    sections: [
      section({
        ordinal: 1,
        kind: 'hero',
        background: '#fff8f0',
        items: [
          image({ role: 'logo', src: 'https://email-uploads.invalid/0.png' }),
          text({
            role: 'headline',
            color: '#2b2118',
            runs: [{ text: 'Layers for quiet weekends' }]
          }),
          button({ background: '#8a5a2b', color: '#ffffff' })
        ]
      })
    ]
  })

describe('the look kept check (DES-ENGINE-003b)', () => {
  it('passes the original itself, and names what changed', () => {
    expect(lookProblems(own(), own())).toEqual([])
    const drawn = own()
    drawn.page = '#ffffff'
    const s = drawn.sections[0]!
    s.items = s.items.map((i) =>
      i.type === 'button'
        ? { ...i, background: '#000000' }
        : i.type === 'image'
          ? { ...i, src: 'https://cdn.shopify.com/x.png' }
          : i
    )
    const got = lookProblems(own(), drawn)
    expect(got[0]).toMatch(/colour around the email/)
    expect(got[1]).toMatch(/^Section 1 \(hero\) has another logo/)
  })

  it('leaves sections built from a library block out', () => {
    const drawn = own()
    drawn.sections[0]!.background = '#000000'
    expect(lookProblems(own(), drawn, new Set([1]))).toEqual(
      lookProblems(own(), own(), new Set([1]))
    )
  })

  it('accepts words made readable where the original’s could not be read', () => {
    const faint = own()
    const s = faint.sections[0]!
    s.items = s.items.map((i) =>
      i.type === 'text' ? { ...i, color: '#f2ece4' } : i
    )
    const drawn = own()
    expect(lookProblems(faint, drawn)).toEqual([])
  })
})

describe('the keepLook swap (DES-ENGINE-003b)', () => {
  it('keeps the colours, fonts and pictures, and changes the words and links', () => {
    const got = swapBrand({
      source: own(),
      brand: testBrand,
      products: testProducts,
      words: testWords,
      rules: testRules,
      keepLook: true
    })
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.target.page).toBe('#f4efe6')
    expect(got.target.sections[0]!.background).toBe('#fff8f0')
    const [logo, headline, cta] = got.target.sections[0]!
      .items as never[] as Record<string, unknown>[]
    expect(logo!.src).toBe('https://email-uploads.invalid/0.png')
    expect(headline!.color).toBe('#2b2118')
    expect((headline!.font as { family: string }).family).toBe(
      (own().sections[0]!.items[1] as { font: { family: string } }).font.family
    )
    expect(JSON.stringify(headline!.runs)).not.toContain(
      'Layers for quiet weekends'
    )
    expect(cta!.background).toBe('#8a5a2b')
    expect(cta!.href).toBe(testProducts[0]!.url)
    expect(lookProblems(own(), got.target)).toEqual([])
  })

  it('builds a section whose picture is not one of the file’s own from a block, saying why', () => {
    const source = own()
    source.sections[0]!.items[0] = image({
      role: 'hero_photo',
      src: 'https://images.example/hero.jpg'
    })
    const got = swapBrand({
      source,
      brand: testBrand,
      products: testProducts,
      words: testWords,
      rules: testRules,
      keepLook: true
    })
    expect(got.ok && got.blocked.get(1)).toBe(
      'has a picture on images.example, a site GROS doesn’t load pictures from'
    )
  })
})
