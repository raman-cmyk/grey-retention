import { describe, expect, it } from 'vitest'
import { blockTypes, parseBlock, type Block } from './catalog'
import { klaviyoFooterTags } from './klaviyo-tags'
import {
  GMAIL_CLIP_BYTES,
  blockPreviewDocument,
  emailBytes,
  escapeHtml,
  renderBlock,
  renderEmail,
  safeImageUrl,
  safeUrl
} from './render'
import { sampleBlocks, sampleBrand } from './samples'

const all = blockTypes.map((t) => sampleBlocks[t])
const block = (type: Parameters<typeof parseBlock>[0], content: unknown) => {
  const parsed = parseBlock(type, content)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.block
}

describe('every block renders email-safe HTML in the brand', () => {
  for (const type of blockTypes)
    it(type, () => {
      const html = renderBlock(sampleBlocks[type], sampleBrand)
      expect(html).toContain(`data-block="${type}"`)
      // Brand font first, with the web-safe stack behind it.
      expect(html).toContain(
        "'Playfair Display', Georgia, 'Times New Roman', Times, serif"
      )
      // No script, form, frame, external stylesheet or web font link.
      expect(html).not.toMatch(
        /<script|<form|<iframe|<link|@import|javascript:|on\w+=/i
      )
      // Every image carries alt text.
      for (const img of html.match(/<img [^>]*>/g) ?? [])
        expect(img).toMatch(/ alt="[^"]+"/)
    })

  it('uses the brand colours where they belong', () => {
    const offer = renderBlock(sampleBlocks.offer_banner, sampleBrand)
    expect(offer).toContain('background:#2f4a3a')
    // White text on the dark green banner, not the page ink.
    expect(offer).toContain('color:#ffffff')
    const bar = renderBlock(sampleBlocks.free_shipping_bar, sampleBrand)
    expect(bar).toContain('background:#c9a96e')
    const hero = renderBlock(sampleBlocks.hero, sampleBrand)
    expect(hero).toContain('color:#2f4a3a')
  })

  it('writes all text as HTML text, never inside an image', () => {
    const hero = renderBlock(sampleBlocks.hero, sampleBrand)
    expect(hero).toContain('>Slow mornings, made softer</h1>')
    const offer = renderBlock(sampleBlocks.offer_banner, sampleBrand)
    expect(offer).toContain('WELCOME15')
  })

  it('shows the logo when the kit has one, else the brand name', () => {
    const withLogo = renderBlock(sampleBlocks.header, {
      ...sampleBrand,
      logo: { url: 'https://cdn.example/logo.png' }
    })
    expect(withLogo).toContain('<img src="https://cdn.example/logo.png"')
    expect(withLogo).toContain('alt="Cedar Lane"')
    const noLogo = renderBlock(sampleBlocks.header, sampleBrand)
    expect(noLogo).toContain('>Cedar Lane</p>')
  })

  it('shows a struck-through old price only when there is one', () => {
    const feature = renderBlock(sampleBlocks.product_feature, sampleBrand)
    expect(feature).toMatch(/line-through[^>]*>\$110</)
    const grid = renderBlock(sampleBlocks.product_grid_2, sampleBrand)
    expect(grid).not.toContain('line-through')
  })

  it('rates reviews with text stars and an accessible label', () => {
    const html = renderBlock(sampleBlocks.review_strip, sampleBrand)
    expect(html).toContain('aria-label="4 out of 5 stars"')
    expect(html).toContain('★★★★☆')
  })
})

describe('nothing a writer types can break the email', () => {
  it('escapes HTML and Klaviyo template syntax', () => {
    expect(escapeHtml(`<b>"Hi" & {{ person.email }} {% unsubscribe %}`)).toBe(
      '&lt;b&gt;&quot;Hi&quot; &amp; &#123;&#123; person.email &#125;&#125; &#123;% unsubscribe %&#125;'
    )
    const html = renderBlock(
      block('text', {
        headline: '<script>alert(1)</script>',
        body: 'Hi {{ first_name }}'
      }),
      sampleBrand
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('{{')
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps only https, http and mailto links', () => {
    expect(safeUrl('https://shop.example/a?b=1&c=2')).toBe(
      'https://shop.example/a?b=1&amp;c=2'
    )
    expect(safeUrl('mailto:hello@shop.example')).toBe(
      'mailto:hello@shop.example'
    )
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'vbscript:x',
      'not a url',
      '//evil.example'
    ])
      expect(safeUrl(bad)).toBe('#')
    const html = renderBlock(
      block('cta', { cta: { label: 'Go', url: 'javascript:alert(1)' } }),
      sampleBrand
    )
    expect(html).toContain('href="#"')
  })

  it('keeps only https images and inline preview images', () => {
    expect(safeImageUrl('https://cdn.example/a.jpg')).toBe(
      'https://cdn.example/a.jpg'
    )
    expect(safeImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(
      'data:image/png;base64,iVBORw0KGgo='
    )
    for (const bad of [
      'http://cdn.example/a.jpg',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/svg+xml,<svg onload=alert(1)>',
      'javascript:alert(1)'
    ])
      expect(safeImageUrl(bad)).toBeNull()
    const html = renderBlock(
      block('hero', {
        image: { url: 'http://cdn.example/a.jpg', alt: 'Photo' },
        headline: 'Hi',
        cta: { label: 'Shop', url: 'https://shop.example' }
      }),
      sampleBrand
    )
    expect(html).not.toContain('<img')
  })

  it('ignores colours and fonts that are not safe', () => {
    const html = renderBlock(sampleBlocks.offer_banner, {
      ...sampleBrand,
      colors: {
        primary: 'red;background:url(https://evil.example)',
        accent: '#c9a96e',
        background: '#fff'
      },
      font: "x'}*{display:none"
    })
    expect(html).not.toContain('evil.example')
    expect(html).not.toContain('display:none')
    expect(html).toContain('background:#1a1a1a')
  })
})

describe('the footer carries what Klaviyo requires', () => {
  it('writes the Klaviyo tags when it goes to Klaviyo', () => {
    const html = renderBlock(sampleBlocks.footer, sampleBrand, 'klaviyo')
    for (const tag of Object.values(klaviyoFooterTags))
      expect(html).toContain(tag)
    expect(html).toContain('>Unsubscribe</a>')
    expect(html).toContain('>View in browser</a>')
  })

  it('never shows raw tags in our own preview', () => {
    const html = renderBlock(sampleBlocks.footer, sampleBrand, 'preview')
    expect(html).not.toMatch(/\{%|\{\{/)
    expect(html).toContain('Cedar Lane')
    expect(html).toContain('Klaviyo adds it when it sends')
  })
})

describe('renderEmail', () => {
  const html = renderEmail({
    blocks: all,
    brand: sampleBrand,
    subject: 'Slow mornings',
    preheader: 'The linen collection is here',
    mode: 'klaviyo'
  })

  it('is a 600px, phone-ready document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta name="viewport"')
    expect(html).toContain('width="600"')
    expect(html).toContain('max-width:600px')
    expect(html).toContain('@media only screen and (max-width:620px)')
    expect(html).toContain(
      '.gr-col{display:block!important;width:100%!important'
    )
    expect(html).toContain('<title>Slow mornings</title>')
    expect(html).toContain('The linen collection is here')
  })

  it('stays under the Gmail clipping size with all 20 blocks', () => {
    expect(emailBytes(html)).toBeLessThan(GMAIL_CLIP_BYTES)
  })

  it('always ends with exactly one footer', () => {
    const blocks: Block[] = [sampleBlocks.hero]
    const one = renderEmail({ blocks, brand: sampleBrand, mode: 'klaviyo' })
    expect(one.match(/data-block="footer"/g)).toHaveLength(1)
    expect(one.indexOf('data-block="footer"')).toBeGreaterThan(
      one.indexOf('data-block="hero"')
    )
    const twice = renderEmail({
      blocks: [sampleBlocks.footer, sampleBlocks.hero, sampleBlocks.footer],
      brand: sampleBrand,
      mode: 'klaviyo'
    })
    expect(twice.match(/data-block="footer"/g)).toHaveLength(1)
    expect(twice.indexOf('data-block="footer"')).toBeGreaterThan(
      twice.indexOf('data-block="hero"')
    )
    expect(twice).toContain(klaviyoFooterTags.unsubscribe)
  })

  it('keeps the blocks in the order given', () => {
    const order = [...html.matchAll(/data-block="([a-z_0-9]+)"/g)]
      .map((m) => m[1])
      .filter((t, i, list) => t !== list[i - 1])
    expect(order).toEqual(blockTypes)
  })
})

describe('blockPreviewDocument (gallery)', () => {
  it('shows one block in the email frame, without a footer or Klaviyo tags', () => {
    const html = blockPreviewDocument(sampleBlocks.hero, sampleBrand)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('data-block="hero"')
    expect(html).not.toContain('data-block="footer"')
    expect(html).not.toMatch(/\{%|\{\{/)
    expect(html).toContain('@media only screen and (max-width:620px)')
  })
})
