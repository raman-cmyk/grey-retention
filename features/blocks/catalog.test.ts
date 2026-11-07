import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  blockCatalog,
  blockTypes,
  isBlockType,
  parseBlock,
  parseSpecBlock,
  referenceBlockTypes
} from './catalog'
import { sampleBlocks } from './samples'

describe('the block catalog (VISION Step 1)', () => {
  it('has exactly 20 types, each named and explained once', () => {
    expect(blockTypes).toHaveLength(20)
    expect(new Set(blockCatalog.map((b) => b.name)).size).toBe(20)
    for (const b of blockCatalog) {
      expect(b.purpose).toMatch(/\.$/)
      expect(b.needs.length).toBeGreaterThan(3)
    }
  })

  it('keeps every Step 0 reference type under its own key', () => {
    expect(blockTypes).toEqual(expect.arrayContaining([...referenceBlockTypes]))
    expect(referenceBlockTypes).toHaveLength(10)
  })

  it('covers the kinds the brief names and has no countdown timer', () => {
    expect(blockTypes).toEqual(
      expect.arrayContaining([
        'hero_product',
        'hero_image',
        'offer_banner',
        'product_grid_2col',
        'product_grid_3col',
        'product_feature',
        'review_strip',
        'founder_note',
        'before_after',
        'ugc_grid',
        'faq',
        'announcement_bar',
        'category_tiles',
        'footer'
      ])
    )
    expect(blockTypes.some((t) => /count|timer/.test(t))).toBe(false)
    expect(blockTypes.at(-1)).toBe('footer')
  })

  it('knows its own keys only', () => {
    expect(isBlockType('hero_product')).toBe(true)
    expect(isBlockType('countdown')).toBe(false)
    expect(isBlockType('toString')).toBe(false)
    expect(isBlockType(3)).toBe(false)
  })

  it('has a valid sample for every type', () => {
    for (const type of blockTypes) expect(sampleBlocks[type].type).toBe(type)
  })
})

describe('Step 0 spec conformance (docs/step0/example_spec.json)', () => {
  const spec = JSON.parse(
    readFileSync('docs/step0/example_spec.json', 'utf8')
  ) as { blocks: unknown[] }

  it('reads every block of the Step 0 example as it is', () => {
    for (const b of spec.blocks) {
      const parsed = parseSpecBlock(b)
      expect(parsed, JSON.stringify(b)).toMatchObject({ ok: true })
    }
  })

  it('refuses unknown types and unknown fields', () => {
    expect(parseSpecBlock({ type: 'countdown', ends: 'soon' })).toMatchObject({
      ok: false
    })
    expect(
      parseSpecBlock({
        type: 'cta',
        label: 'Go',
        url: 'https://x.example',
        colour: 'red'
      })
    ).toMatchObject({ ok: false })
    expect(parseSpecBlock(null)).toMatchObject({ ok: false })
  })
})

describe('parseBlock (what the assembly step must fill)', () => {
  const product = {
    title: 'Throw',
    price: '$89',
    image: 'https://cdn.example/a.jpg',
    url: 'https://shop.example/a'
  }

  it('refuses product grids with the wrong number of products', () => {
    const result = parseBlock('product_grid_2col', {
      products: [product, product, product]
    })
    expect(!result.ok && result.error).toMatch(/Use 2 or 4 products/)
  })

  it('needs alt text on photos and words on every button', () => {
    expect(
      parseBlock('hero_image', {
        image: 'https://cdn.example/a.jpg',
        alt: ' ',
        headline: 'Hi',
        url: 'https://shop.example',
        cta: 'Shop'
      })
    ).toMatchObject({ ok: false })
    expect(
      parseBlock('cta', { label: '', url: 'https://shop.example' })
    ).toMatchObject({ ok: false })
  })

  it('accepts only safe links and https pictures', () => {
    for (const url of [
      'javascript:alert(1)',
      'not a url',
      '//evil.example',
      'https://user:pw@shop.example/'
    ])
      expect(parseBlock('cta', { label: 'Go', url }), url).toMatchObject({
        ok: false
      })
    expect(
      parseBlock('cta', { label: 'Mail us', url: 'mailto:hi@shop.example' })
    ).toMatchObject({ ok: true })
    for (const image of [
      'http://cdn.example/a.jpg',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:text/html;base64,PHA+',
      'https://cdn.example/' + 'a'.repeat(2000)
    ])
      expect(
        parseBlock('product_grid_2col', {
          products: [{ ...product, image }, product]
        }),
        image.slice(0, 40)
      ).toMatchObject({ ok: false })
  })

  it('caps text so a block cannot grow without limit', () => {
    expect(
      parseBlock('announcement_bar', { text: 'x'.repeat(91) })
    ).toMatchObject({ ok: false })
    expect(
      parseBlock('review_strip', {
        reviews: Array(4).fill({ quote: 'Nice', author: 'A', rating: 5 })
      })
    ).toMatchObject({ ok: false })
    for (const rating of [0, 6, 4.5, '5'])
      expect(
        parseBlock('review_strip', {
          reviews: [{ quote: 'Nice', author: 'A', rating }]
        })
      ).toMatchObject({ ok: false })
  })

  it('fills defaults and trims text', () => {
    expect(parseBlock('text', { paras: ['  Hello  '] })).toEqual({
      ok: true,
      block: { type: 'text', content: { paras: ['Hello'], align: 'center' } }
    })
    const ba = parseBlock('before_after', {
      before: { image: 'https://cdn.example/b.jpg', alt: 'Before photo' },
      after: { image: 'https://cdn.example/a.jpg', alt: 'After photo' }
    })
    expect(ba.ok && ba.block.content).toMatchObject({
      beforeLabel: 'Before',
      afterLabel: 'After'
    })
  })
})

describe('docs/BLOCK_LIBRARY.md (the list the owner approves)', () => {
  it('lists every block type in catalog order', () => {
    const doc = readFileSync('docs/BLOCK_LIBRARY.md', 'utf8')
    const listed = [...doc.matchAll(/\(`([a-z_0-9]+)`\)/g)].map((m) => m[1])
    expect(listed).toEqual(blockTypes)
    for (const b of blockCatalog) expect(doc).toContain(`**${b.name}**`)
  })
})
