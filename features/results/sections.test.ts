// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderEmail } from '@/features/blocks/render'
import { sampleBlocks, sampleBrand } from '@/features/blocks/samples'
import { emailSections, keptUrl, linkKey, sectionOf } from './sections'

describe('the sections of an email we built', () => {
  it('reads each coded block in order with the links it holds', () => {
    const html = renderEmail({
      blocks: [
        sampleBlocks.header_logo,
        sampleBlocks.hero_product,
        sampleBlocks.offer_banner,
        sampleBlocks.footer
      ],
      brand: sampleBrand
    })
    const sections = emailSections(html)
    expect(sections.map((s) => [s.index, s.block])).toEqual([
      [0, 'header_logo'],
      [1, 'hero_product'],
      [2, 'offer_banner'],
      [3, 'footer']
    ])
    // The hero's own link is the hero's, nowhere else.
    const hero = sections[1]!.links[0]!
    expect(sectionOf(sections, `https://${hero}?utm_source=klaviyo`)).toEqual({
      section: 1,
      block: 'hero_product'
    })
  })

  it('counts a link in two sections, or in none, for no section', () => {
    const html =
      '<table>' +
      '<tr data-block="hero_product"><td><a href="https://shop.example/p/1">A</a></td></tr>' +
      '<tr data-block="product_grid"><td><a href="https://shop.example/p/1">A again</a><a href="https://shop.example/p/2">B</a>' +
      '<table><tr data-block="text"><td><a href="https://shop.example/p/3">inner</a></td></tr></table></td></tr>' +
      '<tr data-block="Bad Name"><td><a href="https://shop.example/p/4">x</a></td></tr>' +
      '</table>'
    const sections = emailSections(html)
    // A block inside a block is the outer block's.
    expect(sections.map((s) => [s.block, s.links])).toEqual([
      ['hero_product', ['shop.example/p/1']],
      [
        'product_grid',
        ['shop.example/p/1', 'shop.example/p/2', 'shop.example/p/3']
      ]
    ])
    expect(sectionOf(sections, 'https://shop.example/p/1')).toBeNull()
    expect(sectionOf(sections, 'https://shop.example/p/2')).toEqual({
      section: 1,
      block: 'product_grid'
    })
    expect(sectionOf(sections, 'https://manage.kmail-lists.com/x')).toBeNull()
    expect(sectionOf(sections, 'mailto:hi@shop.example')).toBeNull()
  })

  it('writes an address one way: tracking left out, host in small letters, no slash or fragment', () => {
    expect(
      linkKey(
        'https://Shop.Example/products/knit/?utm_source=klaviyo&utm_medium=email&_kx=abc&color=oat#reviews'
      )
    ).toBe('shop.example/products/knit?color=oat')
    expect(linkKey('http://shop.example/')).toBe('shop.example')
    expect(linkKey('{% unsubscribe %}')).toBeNull()
    expect(linkKey('javascript:alert(1)')).toBeNull()
    // The account's own tracking parameters, when named.
    expect(linkKey('https://shop.example/p?ref=nl&size=m', ['ref'])).toBe(
      'shop.example/p?size=m'
    )
  })

  it('never keeps the parameters that name the person who clicked', () => {
    expect(
      keptUrl('https://shop.example/p?_kx=person.abc&utm_source=klaviyo&_ke=x')
    ).toBe('https://shop.example/p?utm_source=klaviyo')
    expect(keptUrl('mailto:a@b.example')).toBeNull()
    expect(keptUrl(`https://shop.example/${'x'.repeat(2_000)}`)).toBeNull()
  })
})
