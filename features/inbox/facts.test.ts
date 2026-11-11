// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { blockTypes } from '@/features/blocks/catalog'
import { angleOf, codeOf, ctaOf, emailFacts, offerOf } from './facts'
import { sampleLabel } from './labeller'
import { sectionEmail } from './sections'

const newsletter = `<html><body>
<div style="display:none">Light layers, made to last</div>
<table width="600">
  <tr><td>Free shipping over $50</td></tr>
  <tr><td><img src="https://cdn.northwind.example/logo.png" width="140" alt="Northwind"></td></tr>
  <tr><td><img src="https://cdn.northwind.example/hero.jpg" width="600"></td></tr>
  <tr><td><h1>New arrivals: spring layers</h1><p>Light jackets and overshirts for the days that cannot decide. Use code SPRING20 for 20% off this week only, on every new piece in the drop.</p></td></tr>
  <tr><td><a href="https://northwind.example/new">Shop new arrivals</a></td></tr>
  <tr><td><table><tr><td><img src="https://cdn.northwind.example/p1.jpg" width="280"><p>Overshirt $68</p></td><td><img src="https://cdn.northwind.example/p2.jpg" width="280"><p>Jacket $120</p></td></tr></table></td></tr>
  <tr><td>Questions? Reply to this email. Thanks for reading, see you soon.</td></tr>
  <tr><td>Northwind Outdoor, 1 Sample Street. <a href="https://northwind.example/u">Unsubscribe</a></td></tr>
</table></body></html>`

describe('the sample labeller', () => {
  it('names each section with one of the 20 block types, or says unsure', () => {
    const { sections } = sectionEmail(newsletter)
    const labels = sections.map((s) =>
      sampleLabel(s, { ordinal: s.ordinal, of: sections.length })
    )
    expect(labels.map((l) => l.type)).toEqual([
      'announcement_bar',
      'header_logo',
      'hero_image',
      'text',
      'cta',
      'product_grid_2col',
      'signoff',
      'footer'
    ])
    for (const l of labels) {
      expect([...blockTypes, 'unsure']).toContain(l.type)
      expect(l.source).toBe('sample')
      expect(l.confidence).toBeGreaterThan(0)
    }
  })

  it('labels "View in browser" at the top as the top bar, and a 6-product grid by its columns', () => {
    const base = {
      html: '',
      words: 3,
      images: 0,
      wideImages: 0,
      links: [],
      kind: 'text' as const
    }
    expect(
      sampleLabel(
        { ...base, ordinal: 1, text: 'View in browser' },
        { ordinal: 1, of: 8 }
      ).type
    ).toBe('announcement_bar')
    const grid = {
      ...base,
      ordinal: 4,
      text: 'A $10 B $12 C $14 D $16 E $18 F $20',
      words: 12,
      images: 6,
      kind: 'design' as const
    }
    expect(
      sampleLabel({ ...grid, html: '<td width="50%">' }, { ordinal: 4, of: 8 })
        .type
    ).toBe('product_grid_2col')
    expect(
      sampleLabel({ ...grid, html: '<td width="33%">' }, { ordinal: 4, of: 8 })
        .type
    ).toBe('product_grid_3col')
    expect(
      sampleLabel(
        { ...base, ordinal: 7, text: 'An exotic new scent for you', words: 6 },
        { ordinal: 7, of: 8 }
      ).type
    ).not.toBe('signoff')
  })

  it('says unsure about a picture-heavy section it cannot place', () => {
    expect(
      sampleLabel(
        {
          ordinal: 9,
          html: '',
          text: '',
          words: 0,
          images: 2,
          wideImages: 0,
          links: [],
          kind: 'design'
        },
        { ordinal: 9, of: 12 }
      ).type
    ).toBe('unsure')
  })
})

describe('micro facts', () => {
  it('reads the offer, angle, call to action and shape of one email', () => {
    const { sections, preheader, textRatio } = sectionEmail(newsletter)
    const facts = emailFacts({
      subject: 'Spring layers are here',
      preview: preheader,
      sections,
      sentAt: '2026-11-03T15:00:00.000Z',
      blockSequence: ['announcement_bar', 'header_logo', 'hero_image'],
      textRatio
    })
    expect(facts).toMatchObject({
      version: 2,
      preview: 'Light layers, made to last',
      // The standing "Free shipping" bar is not this email's offer.
      offer: { kind: 'percent', value: 20, code: 'SPRING20' },
      angle: 'seasonal',
      cta: 'Shop new arrivals',
      sentAt: '2026-11-03T15:00:00.000Z',
      sections: 8
    })
  })

  it('finds each kind of offer, the strongest first', () => {
    expect(
      offerOf('Save up to 40% today, or 25% off sale items')
    ).toMatchObject({ kind: 'percent', value: 40 })
    expect(offerOf('$15 off your first order')).toMatchObject({
      kind: 'amount',
      value: 15
    })
    expect(offerOf('Buy one, get one on all socks')).toMatchObject({
      kind: 'bogo'
    })
    expect(offerOf('A free gift with every order')).toMatchObject({
      kind: 'gift'
    })
    expect(offerOf('Free shipping this weekend')).toMatchObject({
      kind: 'free_shipping'
    })
    expect(offerOf('Our founder on slow mornings')).toEqual({
      kind: 'none',
      value: null,
      code: null
    })
    expect(offerOf('Use code: WELCOME10 at checkout').code).toBe('WELCOME10')
  })

  it('names the angle by fixed rules', () => {
    expect(angleOf('Back in stock: the field overshirt')).toBe('restock')
    expect(angleOf('Black Friday starts now')).toBe('seasonal')
    expect(angleOf('Introducing the rain shell')).toBe('launch')
    expect(angleOf('Last chance: 30% off ends tonight')).toBe('sale')
    expect(angleOf('Our best sellers, restyled')).toBe('bestseller')
    expect(angleOf('What 2,000 customers say')).toBe('social_proof')
    expect(angleOf('A letter from our founder')).toBe('story')
    expect(angleOf('How to care for linen')).toBe('education')
    expect(angleOf('The weekend bundle')).toBe('bundle')
    expect(angleOf('Hello')).toBe('other')
  })

  it('reads codes in any case of "code", but only capital codes', () => {
    expect(codeOf('Code: SUMMER')).toBe('SUMMER')
    expect(codeOf('CODE SUMMER20 ends Sunday')).toBe('SUMMER20')
    expect(codeOf('Get 15% OFF with code WELCOME15')).toBe('WELCOME15')
    expect(codeOf('Use LINEN for 10% off')).toBe('LINEN')
    expect(codeOf('USE THE CODE BELOW')).toBeNull()
    expect(codeOf('Use FREE shipping today')).toBeNull()
    expect(codeOf('use the code at checkout')).toBeNull()
  })

  it('does not read 100% cotton or 100% off as a small discount', () => {
    expect(offerOf('100% cotton tee, now in 3 colours').kind).toBe('none')
    expect(offerOf('take 100% off').kind).toBe('none')
    expect(offerOf('Save 2.50% now').kind).toBe('none')
    expect(offerOf('Up to 50% off everything')).toMatchObject({
      kind: 'percent',
      value: 50
    })
  })

  it('does not take season words, the founder or a "set" for the wrong angle', () => {
    expect(angleOf('Our spring sale ends tonight')).toBe('sale')
    expect(angleOf('Fall in love with our new linen')).toBe('other')
    expect(angleOf('The fall collection is here')).toBe('seasonal')
    expect(angleOf('Summer linen, light and cool')).toBe('seasonal')
    expect(angleOf('Meet the founder')).toBe('story')
    expect(angleOf('Meet the new rain shell')).toBe('launch')
    expect(angleOf('This is the best set ever')).toBe('other')
    expect(angleOf('The gift set for him')).toBe('bundle')
  })

  it('skips the top bar, the menu and the footer for the offer and the button', () => {
    const section = (
      ordinal: number,
      text: string,
      links: { text: string; href: string }[] = []
    ) => ({
      ordinal,
      html: '',
      text,
      words: text.split(' ').length,
      images: 0,
      wideImages: 0,
      kind: 'text' as const,
      links
    })
    const sections = [
      section(1, 'Free shipping over $50', [
        { text: 'Shop now', href: 'https://x.test/bar' }
      ]),
      section(2, 'Shop New Sale', [{ text: 'Shop', href: 'https://x.test/s' }]),
      section(3, 'Our founder on slow mornings and why the kettle comes first'),
      section(4, 'Read the story', [
        { text: 'Read the story', href: 'https://x.test/r' }
      ]),
      section(5, 'Get 15% off your first order. Unsubscribe', [
        { text: 'Get 15% off', href: 'https://x.test/f' }
      ])
    ]
    const facts = emailFacts({
      subject: 'Slow mornings',
      preview: null,
      sections,
      sentAt: '2026-11-03T15:00:00.000Z',
      blockSequence: [
        'announcement_bar',
        'header_logo',
        'founder_note',
        'cta',
        'footer'
      ],
      textRatio: 1
    })
    expect(facts.offer.kind).toBe('none')
    expect(facts.cta).toBe('Read the story')
  })

  it('finds the main call to action, never a footer link', () => {
    expect(
      ctaOf([
        {
          ordinal: 1,
          html: '',
          text: '',
          words: 0,
          images: 0,
          wideImages: 0,
          kind: 'text',
          links: [
            { text: 'Unsubscribe', href: 'https://x.test/u' },
            { text: 'View in browser', href: 'https://x.test/v' }
          ]
        },
        {
          ordinal: 2,
          html: '',
          text: '',
          words: 0,
          images: 0,
          wideImages: 0,
          kind: 'text',
          links: [{ text: 'Discover the collection', href: 'https://x.test/c' }]
        }
      ])
    ).toBe('Discover the collection')
    expect(ctaOf([])).toBeNull()
  })
})
