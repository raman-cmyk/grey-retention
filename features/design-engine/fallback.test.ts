import { describe, expect, it } from 'vitest'
import { brandFromBlueprint, fallbackFor } from './fallback'
import {
  blueprint,
  button,
  gridSection,
  image,
  section,
  text
} from './fixtures'

describe('the closest library block', () => {
  const brand = brandFromBlueprint(blueprint())

  it('reads the block brand from the email itself', () => {
    expect(brand).toMatchObject({
      name: '',
      site: 'https://example.com',
      font: 'Arial',
      ink: '#333333',
      background: '#f2f2f2',
      accent: '#222222',
      radius: '4px'
    })
  })

  it('links a block to no made-up store: only the email’s own first https link, or none', () => {
    const noLinks = blueprint({
      sections: [
        section({
          items: [image({ href: null }), text(), button({ href: null })]
        })
      ]
    })
    expect(brandFromBlueprint(noLinks)).toMatchObject({ name: '', site: '' })
  })

  it('never invents button words: a block that needs a button needs the section’s own', () => {
    const noButton = section({
      kind: 'offer',
      items: [text({ role: 'headline', runs: [{ text: 'Half off' }] })]
    })
    const f = fallbackFor(noButton, 'still differed', brand)
    expect(f.block).toBe('text')
    expect(f.rows).not.toContain('Shop now')
  })

  it('builds a section with a countdown timer from an offer block, never reusing the timer', () => {
    const timer = section({
      ordinal: 3,
      kind: 'offer',
      unsupported: 'a countdown timer or moving picture',
      items: [
        text({ role: 'headline', runs: [{ text: 'Sale ends soon' }] }),
        image({ src: 'https://example.com/countdown.gif', role: 'photo' }),
        button()
      ]
    })
    const f = fallbackFor(
      timer,
      'has a countdown timer or moving picture, which cannot be copied',
      brand
    )
    expect(f.block).toBe('offer_banner')
    expect(f.reason).toBe(
      "Section 3 (offer) has a countdown timer or moving picture, which cannot be copied, so it was built from the library's Offer banner block."
    )
    expect(f.rows).toContain('Sale ends soon')
    expect(f.rows).not.toContain('countdown.gif')
    expect(f.rows).toMatch(/^<tr\b/)
  })

  it('builds a product grid from the grid block with the section’s own products', () => {
    const grid = gridSection(2)
    // Each card needs a title for the grid block.
    for (const item of grid.items)
      if (item.type === 'row')
        for (const c of item.columns)
          c.items.push(
            text({ role: 'product_name', runs: [{ text: 'A product' }] })
          )
    const f = fallbackFor(grid, 'still differed', brand)
    expect(f.block).toBe('product_grid_2col')
    expect(f.rows).toContain('A product')
  })

  it('falls back to plain text when the closest block cannot be filled', () => {
    const hero = section({
      items: [text({ role: 'headline', runs: [{ text: 'Only words here' }] })]
    })
    expect(fallbackFor(hero, 'still differed', brand).block).toBe('text')
  })

  it('leaves out a section with nothing a block can draw, and says so', () => {
    const empty = section({
      ordinal: 4,
      kind: 'image',
      items: [image({ src: 'https://example.com/a.gif' })]
    })
    const f = fallbackFor(
      empty,
      'has a countdown timer or moving picture, which cannot be copied',
      brand
    )
    expect(f).toMatchObject({ block: null, rows: '' })
    expect(f.reason).toMatch(/^Section 4 \(picture\) .* so it was left out\.$/)
  })
})
