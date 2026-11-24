import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { blockTypes, parseBlock, parseSpecBlock, type Block } from './catalog'
import { klaviyoFooterTags, previewFooterTags } from './klaviyo-tags'
import {
  BlockRenderError,
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
import type { BlockBrand } from './brand'
import { designedHeight } from '@/features/studio/storyboard'

const all = blockTypes.map((t) => sampleBlocks[t])
const block = (type: Parameters<typeof parseBlock>[0], content: unknown) => {
  const parsed = parseBlock(type, content)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.block
}
const httpsBrand: BlockBrand = {
  ...sampleBrand,
  logo: 'https://cdn.example/logo.png'
}

describe('every block renders email-safe HTML in the brand', () => {
  for (const type of blockTypes)
    it(type, () => {
      const html = renderBlock(sampleBlocks[type], sampleBrand)
      expect(html).toContain(`data-block="${type}"`)
      expect(html).not.toMatch(
        /<script|<form|<iframe|<link|@import|javascript:|\son\w+=/i
      )
      for (const img of html.match(/<img [^>]*>/g) ?? [])
        expect(img).toMatch(/ alt="[^"]+"/)
    })

  it('uses the brand font with a web-safe fallback', () => {
    expect(renderBlock(sampleBlocks.text, sampleBrand)).toContain(
      "'Playfair Display', Georgia, 'Times New Roman', Times, serif"
    )
  })

  it('paints colour roles where Step 0 does, with bgcolor for Outlook', () => {
    const bar = renderBlock(sampleBlocks.announcement_bar, sampleBrand)
    expect(bar).toContain('bgcolor="#1f3328"')
    const offer = renderBlock(sampleBlocks.offer_banner, sampleBrand)
    expect(offer).toContain('bgcolor="#2f4a3a"')
    // White text on the dark green banner.
    expect(offer).toContain('color:#ffffff')
    const cta = renderBlock(sampleBlocks.cta, sampleBrand)
    expect(cta).toMatch(
      /<td bgcolor="#2f4a3a" align="center" style="[^"]*padding:14px 32px/
    )
  })

  it('writes the main message as the one h1, and every word as text', () => {
    const html = renderEmail({
      blocks: [sampleBlocks.hero_product, sampleBlocks.offer_banner],
      brand: sampleBrand
    })
    expect(html.match(/<h1 /g)).toHaveLength(1)
    expect(html).toContain('>Meet the Washed Linen Throw</h1>')
    expect(html).toContain('>15% off your first order</h2>')
    expect(html).toContain('WELCOME15')
  })

  it('links the logo to the store, or shows the name without one', () => {
    const withLogo = renderBlock(sampleBlocks.header_logo, httpsBrand)
    expect(withLogo).toContain('<a href="https://cedar-lane.example/"')
    expect(withLogo).toContain(
      '<img src="https://cdn.example/logo.png" alt="Cedar Lane"'
    )
    expect(renderBlock(sampleBlocks.header_logo, sampleBrand)).toContain(
      '>Cedar Lane</span>'
    )
  })

  it('shows a struck-through old price only when there is one', () => {
    expect(renderBlock(sampleBlocks.product_feature, sampleBrand)).toMatch(
      /line-through[^>]*>\$110</
    )
    expect(
      renderBlock(sampleBlocks.product_grid_2col, sampleBrand)
    ).not.toContain('line-through')
  })

  it('reads stars out as a rating', () => {
    const html = renderBlock(sampleBlocks.review_strip, sampleBrand)
    expect(html).toContain('role="img" aria-label="4 out of 5 stars"')
    expect(html).toContain('★★★★☆')
  })

  it('keeps a long discount code inside a phone screen', () => {
    const html = renderBlock(
      block('offer_banner', {
        headline: 'Off',
        code: 'BLACKFRIDAY2026VIP20EXTRA',
        url: 'https://shop.example',
        cta: 'Shop'
      }),
      sampleBrand
    )
    expect(html).toMatch(/class="gr-code"[^>]*word-break:break-all/)
  })

  it('puts the photo first on a phone even when it sits on the right', () => {
    const html = renderBlock(
      block('image_text', {
        ...sampleBlocks.image_text.content,
        imageSide: 'right'
      }),
      sampleBrand
    )
    expect(html).toContain(' dir="rtl"')
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('<h2'))
  })
})

describe('nothing a writer types can break the email', () => {
  const hostile = '"><x>{{ person.email }}{% unsubscribe %}'
  // Every text field of every sample, replaced with hostile text.
  function poison(value: unknown, key = ''): unknown {
    if (typeof value === 'string') {
      if (
        ['url', 'image', 'site'].includes(key) ||
        /^https?:|^data:/.test(value)
      )
        return value
      if (key === 'panel' || key === 'align' || key === 'imageSide')
        return value
      return hostile.slice(0, 24)
    }
    if (Array.isArray(value)) return value.map((v) => poison(v, key))
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, poison(v, k)])
      )
    return value
  }

  it('escapes HTML and Klaviyo template syntax in every field of every block', () => {
    for (const type of blockTypes) {
      const b = block(type, poison(sampleBlocks[type].content))
      const html = renderBlock(b, { ...sampleBrand, name: hostile })
      expect(html, type).not.toContain('<x>')
      expect(html, type).not.toMatch(/\{\{ person|\{% unsub/)
    }
    expect(escapeHtml('<b>"Hi" & {{ x }} ‮')).toBe(
      '&lt;b&gt;&quot;Hi&quot; &amp; &#123;&#123; x &#125;&#125; '
    )
  })

  it('refuses a block that skipped validation, instead of writing it raw', () => {
    const raw = {
      type: 'review_strip',
      content: {
        reviews: [
          { quote: 'Hi', author: 'A', rating: '5" onmouseover="alert(1)' }
        ]
      }
    } as unknown as Block
    expect(() => renderBlock(raw, sampleBrand)).toThrow(BlockRenderError)
    expect(() =>
      renderEmail({
        blocks: [
          {
            type: 'review_strip',
            content: { reviews: [{ quote: 'Hi', author: 'A', rating: 1e8 }] }
          } as unknown as Block
        ],
        brand: sampleBrand
      })
    ).toThrow(BlockRenderError)
  })

  it('keeps only safe links and pictures', () => {
    expect(safeUrl('https://shop.example/a?b=1&c=2')).toBe(
      'https://shop.example/a?b=1&amp;c=2'
    )
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'not a url',
      'https://u:p@shop.example/'
    ])
      expect(safeUrl(bad)).toBe('#')
    expect(safeImageUrl('https://cdn.example/a.jpg')).toBe(
      'https://cdn.example/a.jpg'
    )
    for (const bad of [
      'http://cdn.example/a.jpg',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'javascript:alert(1)'
    ])
      expect(safeImageUrl(bad)).toBeNull()
  })

  it('refuses inline sample pictures in an email bound for Klaviyo', () => {
    expect(() =>
      renderEmail({ blocks: all, brand: sampleBrand, mode: 'klaviyo' })
    ).toThrow(/Upload every picture to Klaviyo/)
  })

  it('ignores brand colours, radius and fonts that are not safe', () => {
    const html = renderBlock(sampleBlocks.offer_banner, {
      ...sampleBrand,
      accent: 'red;background:url(https://evil.example)',
      radius: '8px;color:red',
      font: "x'}*{display:none"
    })
    expect(html).not.toContain('evil.example')
    expect(html).not.toContain('display:none')
    expect(html).not.toContain('color:red')
  })
})

describe('the footer carries what Klaviyo requires', () => {
  it('writes the Step 0 Klaviyo tags when it goes to Klaviyo', () => {
    const html = renderBlock(sampleBlocks.footer, httpsBrand, 'klaviyo')
    expect(Object.values(klaviyoFooterTags)).toEqual([
      '{{ organization.name }}',
      '{{ organization.full_address }}',
      '{% unsubscribe "Unsubscribe" %}',
      '{% manage_preferences "Preferences" %}',
      '{% web_view "View in browser" %}'
    ])
    for (const tag of Object.values(klaviyoFooterTags))
      expect(html).toContain(tag)
  })

  it('shows an email drawn for Klaviyo with the preview’s placeholders (REL-FTR)', () => {
    const blocks = [sampleBlocks.text, sampleBlocks.footer]
    const sent = renderEmail({ blocks, brand: httpsBrand, mode: 'klaviyo' })
    const preview = renderEmail({ blocks, brand: httpsBrand })
    expect(previewFooterTags(sent, httpsBrand.name)).toBe(preview)
    expect(previewFooterTags(sent, null)).toContain('Your brand<br>')
    expect(previewFooterTags(sent, null)).not.toMatch(/\{%|\{\{/)
  })

  it('never shows raw tags in our own preview', () => {
    const html = renderBlock(sampleBlocks.footer, sampleBrand, 'preview')
    expect(html).not.toMatch(/\{%|\{\{/)
    expect(html).toContain('Klaviyo adds it when it sends')
  })
})

describe('renderEmail', () => {
  const html = renderEmail({
    blocks: all,
    brand: sampleBrand,
    subject: 'Slow mornings',
    preheader: 'The linen collection is here'
  })

  it('is a 600px, phone-ready document on the brand background', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta name="viewport"')
    expect(html).toContain('class="gr-wrap" width="600" bgcolor="#ffffff"')
    expect(html).toContain('bgcolor="#fbf8f2"')
    expect(html).toContain('@media only screen and (max-width:620px)')
    expect(html).toContain('<title>Slow mornings</title>')
    expect(html).toContain('The linen collection is here')
  })

  it('stays under the Gmail clipping size with all 20 sample blocks', () => {
    expect(emailBytes(html)).toBeLessThan(GMAIL_CLIP_BYTES)
  })

  it('always ends with exactly one footer, and keeps the order', () => {
    const twice = renderEmail({
      blocks: [
        sampleBlocks.footer,
        sampleBlocks.hero_image,
        sampleBlocks.footer
      ],
      brand: sampleBrand
    })
    expect(twice.match(/data-block="footer"/g)).toHaveLength(1)
    expect(twice.indexOf('data-block="footer"')).toBeGreaterThan(
      twice.indexOf('data-block="hero_image"')
    )
    const order = [...html.matchAll(/data-block="([a-z_0-9]+)"/g)]
      .map((m) => m[1])
      .filter((t, i, list) => t !== list[i - 1])
    expect(order).toEqual(blockTypes)
  })

  it('renders the Step 0 example in Klaviyo mode, block for block', () => {
    const spec = JSON.parse(
      readFileSync('docs/step0/example_spec.json', 'utf8')
    ) as {
      subject: string
      preview: string
      brand: BlockBrand
      blocks: { type: string }[]
    }
    const blocks = spec.blocks.map((b) => {
      const parsed = parseSpecBlock(b)
      if (!parsed.ok) throw new Error(parsed.error)
      return parsed.block
    })
    const out = renderEmail({
      blocks,
      brand: spec.brand,
      subject: spec.subject,
      preheader: spec.preview,
      mode: 'klaviyo'
    })
    const order = [...out.matchAll(/data-block="([a-z_0-9]+)"/g)]
      .map((m) => m[1])
      .filter((t, i, list) => t !== list[i - 1])
    expect(order).toEqual(spec.blocks.map((b) => b.type))
    expect(out).toContain('Meet the Example Balm')
    expect(out).toContain('{% unsubscribe "Unsubscribe" %}')
    expect(out).toContain("'Poppins', Arial, Helvetica, sans-serif")
    expect(emailBytes(out)).toBeLessThan(GMAIL_CLIP_BYTES)
  })
})

describe('blockPreviewDocument (gallery)', () => {
  it('shows one block in the email frame, without a footer or Klaviyo tags', () => {
    const html = blockPreviewDocument(sampleBlocks.hero_image, sampleBrand)
    expect(html).toContain('data-block="hero_image"')
    expect(html).not.toContain('data-block="footer"')
    expect(html).not.toMatch(/\{%|\{\{/)
  })
})

describe('a hero the design studio drew (DST-006a)', () => {
  const picture = {
    src: 'https://db.example/storage/v1/object/sign/studio-renders/render/x.jpg?token=t',
    alt: 'Just in. Meet the cedar tray. Hand-finished, made to last.',
    height: 640,
    render: '33333333-3333-4333-8333-333333333333'
  }

  it.each(['hero_product', 'hero_image'] as const)(
    '%s shows the picture, linked and full width, with its words as alt, then the live button only',
    (type) => {
      const base = sampleBlocks[type].content as Record<string, unknown>
      const html = renderBlock(
        block(type, { ...base, picture }),
        httpsBrand,
        'klaviyo'
      )
      const img = html.match(/<img [^>]*>/g) ?? []
      expect(img).toHaveLength(1)
      expect(img[0]).toContain(`src="${picture.src.replace(/&/g, '&amp;')}"`)
      expect(img[0]).toContain(`alt="${picture.alt}"`)
      expect(img[0]).toContain('width="600"')
      // Linked like the hero's photo, and the button stays live.
      expect(html).toMatch(
        new RegExp(
          `<a href="${String(base.url).replace(/[.?]/g, '\\$&')}"[^>]*><img`
        )
      )
      expect(html).toContain(`>${String(base.cta)}</a>`)
      // The words are in the picture: never drawn again as HTML.
      expect(html).not.toContain(`>${String(base.headline)}<`)
      if (base.sub) expect(html).not.toContain(String(base.sub))
    }
  )

  it('keeps the picture’s shape while it loads and its background behind the button', () => {
    const base = sampleBlocks.hero_product.content as Record<string, unknown>
    const html = renderBlock(
      block('hero_product', {
        ...base,
        picture: { ...picture, bg: '#1f3a2e' }
      }),
      httpsBrand,
      'klaviyo'
    )
    expect(html.match(/<img [^>]*>/)?.[0]).toContain('height="640"')
    // Both rows (the picture and the button) on the section's background.
    expect(html.match(/bgcolor="#1f3a2e"/g)).toHaveLength(2)
    // With pictures off, the alt shows in the brand's font, readable.
    expect(html.match(/<img [^>]*>/)?.[0]).toMatch(
      /style="[^"]*font-family:[^"]*color:#(?:fff|ffffff)\b/i
    )
    // The eyebrow is in the picture too, and no heading is drawn.
    const outside = html.replace(/ alt="[^"]*"/g, '')
    if (base.eyebrow) expect(outside).not.toContain(String(base.eyebrow))
    // Owner pick #96: the picture is the email's first heading, named by
    // its words; no other heading is drawn.
    expect(html.match(/<h[1-6]\b/g)).toEqual(['<h1'])
    expect(html).toMatch(/<h1 [^>]*><a [^>]*><img [^>]*alt="[^"]+"/)
  })

  it('counts as the email’s first headline: the next is an h2', () => {
    const html = renderEmail({
      blocks: [
        sampleBlocks.header_logo,
        block('hero_product', {
          ...(sampleBlocks.hero_product.content as object),
          picture
        }),
        sampleBlocks.offer_banner
      ],
      brand: httpsBrand,
      mode: 'klaviyo'
    })
    // The studio's picture is the one h1 (owner pick #96).
    expect(html.match(/<h1\b/g)).toHaveLength(1)
    expect(html).toMatch(/<h2/)
  })

  it('takes only an https picture of a designed section’s size, with its render', () => {
    const base = sampleBlocks.hero_product.content as Record<string, unknown>
    for (const bad of [
      { ...picture, src: 'http://db.example/x.jpg' },
      { ...picture, src: 'data:image/png;base64,iVBORw0KGgo=' },
      { ...picture, height: designedHeight.min - 1 },
      { ...picture, height: designedHeight.max + 1 },
      { ...picture, render: 'not-a-render' },
      { ...picture, bg: 'red' },
      { ...picture, extra: 1 }
    ])
      expect(parseBlock('hero_product', { ...base, picture: bad }).ok).toBe(
        false
      )
    for (const height of [designedHeight.min, designedHeight.max])
      expect(
        parseBlock('hero_product', { ...base, picture: { ...picture, height } })
          .ok
      ).toBe(true)
  })

  it('escapes the alt text, braces too', () => {
    const base = sampleBlocks.hero_image.content as Record<string, unknown>
    const html = renderBlock(
      block('hero_image', {
        ...base,
        picture: { ...picture, alt: 'Grove & Co "new" <tray> {{ first_name }}' }
      }),
      httpsBrand,
      'klaviyo'
    )
    expect(html).toContain(
      'alt="Grove &amp; Co &quot;new&quot; &lt;tray&gt; &#123;&#123; first_name &#125;&#125;"'
    )
    expect(html).not.toMatch(/\{\{|\{%/)
  })
})
