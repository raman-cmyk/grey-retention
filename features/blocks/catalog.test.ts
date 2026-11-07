import { describe, expect, it } from 'vitest'
import { blockCatalog, blockTypes, isBlockType, parseBlock } from './catalog'
import { sampleBlocks } from './samples'

describe('the block catalog (VISION Step 1)', () => {
  it('has exactly 20 types, each named and explained once', () => {
    expect(blockTypes).toHaveLength(20)
    expect(new Set(blockTypes).size).toBe(20)
    expect(new Set(blockCatalog.map((b) => b.name)).size).toBe(20)
    for (const b of blockCatalog) {
      expect(b.name.length).toBeGreaterThan(2)
      expect(b.purpose).toMatch(/\.$/)
      expect(b.needs.length).toBeGreaterThan(3)
    }
  })

  it('covers the types the brief names and has no countdown timer', () => {
    expect(blockTypes).toEqual(
      expect.arrayContaining([
        'hero',
        'offer_banner',
        'product_grid_2',
        'product_grid_3',
        'product_feature',
        'review_strip',
        'founder_note',
        'before_after',
        'ugc_grid',
        'faq',
        'free_shipping_bar',
        'category_tiles',
        'footer'
      ])
    )
    expect(blockTypes.some((t) => /count|timer/.test(t))).toBe(false)
    expect(blockTypes.at(-1)).toBe('footer')
  })

  it('knows its own keys only', () => {
    expect(isBlockType('hero')).toBe(true)
    expect(isBlockType('countdown')).toBe(false)
    expect(isBlockType('toString')).toBe(false)
    expect(isBlockType(3)).toBe(false)
  })

  it('has a valid sample for every type', () => {
    for (const type of blockTypes) expect(sampleBlocks[type].type).toBe(type)
  })
})

describe('parseBlock (what the assembly step must fill)', () => {
  it('refuses product grids with the wrong number of products', () => {
    const products = sampleBlocks.product_grid_2.content
    const three = {
      products: [
        ...('products' in products ? products.products : []).slice(0, 3)
      ]
    }
    const result = parseBlock('product_grid_2', three)
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.error).toMatch(/Use 2 or 4 products/)
  })

  it('needs alt text on every image and a label on every button', () => {
    expect(
      parseBlock('hero', {
        image: { url: 'https://cdn.example/a.jpg', alt: ' ' },
        headline: 'Hello',
        cta: { label: 'Shop', url: 'https://shop.example' }
      })
    ).toMatchObject({ ok: false })
    expect(
      parseBlock('cta', { cta: { label: '', url: 'https://shop.example' } })
    ).toMatchObject({ ok: false })
  })

  it('caps text so a block cannot grow without limit', () => {
    expect(
      parseBlock('free_shipping_bar', { text: 'x'.repeat(91) })
    ).toMatchObject({ ok: false })
    expect(
      parseBlock('review_strip', {
        reviews: Array(4).fill({ quote: 'Nice', author: 'A', rating: 5 })
      })
    ).toMatchObject({ ok: false })
    expect(
      parseBlock('review_strip', {
        reviews: [{ quote: 'Nice', author: 'A', rating: 6 }]
      })
    ).toMatchObject({ ok: false })
  })

  it('fills defaults and trims text', () => {
    const header = parseBlock('header', {})
    expect(header).toEqual({
      ok: true,
      block: { type: 'header', content: { links: [] } }
    })
    const ba = parseBlock('before_after', {
      before: { url: 'https://cdn.example/b.jpg', alt: 'Before photo' },
      after: { url: 'https://cdn.example/a.jpg', alt: 'After photo' }
    })
    expect(ba.ok && ba.block.content).toMatchObject({
      beforeLabel: 'Before',
      afterLabel: 'After'
    })
    const text = parseBlock('text', { body: '  Hello  ' })
    expect(text.ok && text.block.content).toEqual({ body: 'Hello' })
  })
})

describe('docs/BLOCK_LIBRARY.md (the list the owner approves)', () => {
  it('lists every block type in catalog order', async () => {
    const { readFileSync } = await import('node:fs')
    const doc = readFileSync('docs/BLOCK_LIBRARY.md', 'utf8')
    const listed = [...doc.matchAll(/\(`([a-z_0-9]+)`\)/g)].map((m) => m[1])
    expect(listed).toEqual(blockTypes)
    for (const b of blockCatalog) expect(doc).toContain(`**${b.name}**`)
  })
})
