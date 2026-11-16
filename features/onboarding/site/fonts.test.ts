import { describe, expect, it } from 'vitest'
import { maxFamilies, siteFonts } from './fonts'

const home = 'https://cedarlane.com/'
const shop = '//cedarlane.com/cdn/fonts'
const page = (head: string, body = '') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`
const style = (css: string, body = '') => page(`<style>${css}</style>`, body)
/** Each family as "name roles kind". */
const kinds = (html: string, sheets?: { url: string; css: string }[]) =>
  siteFonts(html, home, { sheets }).families.map(
    (f) => `${f.family} ${f.roles.join('+') || '-'} ${f.kind}`
  )

describe('siteFonts (FONT-SITE part a)', () => {
  it('reads a Shopify theme: the heading font first, its files by weight and style, the theme stylesheet', () => {
    const html = page(`
      <link href="//cedarlane.com/cdn/shop/t/12/assets/base.css?v=1" rel="stylesheet" media="all">
      <link rel="stylesheet" href="https://reviews-widget.app/widget.css">
      <style data-shopify>
        @font-face { font-family: Assistant; font-weight: 400; font-style: normal; font-display: swap;
          src: url("${shop}/assistant/assistant_n4.9120.woff") format("woff"),
               url("${shop}/assistant/assistant_n4.9120.woff2?h1=Y2VkYXI&hmac=ab12") format("woff2"); }
        @font-face { font-family: Assistant; font-weight: bold;
          src: url("${shop}/assistant/assistant_n7.bf44.woff2?h1=Y2VkYXI") format("woff2"); }
        @font-face { font-family: "Playfair Display"; font-weight: 400 900; font-style: italic;
          src: url("${shop}/playfair/playfair_display_i4.woff2") format("woff2"); }
        :root { --font-body-family: Assistant, sans-serif; --font-body-style: normal; --font-body-scale: 1.0;
          --font-heading-family: "Playfair Display", serif; --font-heading-weight: 700; }
      </style>`)
    const got = siteFonts(html, home)
    expect(kinds(html)).toEqual([
      'Playfair Display heading self-hosted',
      'Assistant body self-hosted'
    ])
    expect(got.families[0]!.files).toEqual([
      {
        url: 'https://cedarlane.com/cdn/fonts/playfair/playfair_display_i4.woff2',
        format: 'woff2',
        weight: 400,
        maxWeight: 900,
        italic: true
      }
    ])
    expect(
      got.families[1]!.files.map((f) => `${f.format} ${f.weight} ${f.italic}`)
    ).toEqual(['woff2 400 false', 'woff 400 false', 'woff2 700 false'])
    expect(got.stylesheets).toEqual([
      {
        url: 'https://cedarlane.com/cdn/shop/t/12/assets/base.css?v=1',
        from: 'site'
      }
    ])
  })

  it('names Google Fonts families from css2, css and @import links, never icon fonts', () => {
    const css2 =
      'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,700&family=Inter:wght@400;600&display=swap'
    const html = page(`
      <link rel="preconnect" href="https://fonts.gstatic.com">
      <link href="${css2}" rel="stylesheet">
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
      <style>@import url('https://fonts.googleapis.com/css?family=Lato:400,700|Open+Sans');
        body { font-family: Inter, system-ui, sans-serif }
        h1, h2, .h3 { font-family: 'Playfair Display', Georgia, serif !important }</style>`)
    expect(kinds(html)).toEqual([
      'Playfair Display heading google',
      'Inter body google',
      'Lato - google',
      'Open Sans - google'
    ])
    const sheets = siteFonts(html, home).stylesheets
    expect(sheets.map((s) => s.from)).toEqual(['google', 'google'])
    expect(sheets[0]!.url).toBe(new URL(css2).href)
  })

  it('lists an Adobe Fonts kit (its families are in its stylesheet) and reads Adobe files', () => {
    const af = 'https://use.typekit.net/af/2d6f0b/00000000003b9b0939/27'
    const html =
      page(`<link rel="StyleSheet" href="https://use.typekit.net/abc1def.css">
      <script src="//use.typekit.net/xyz9876.js"></script>
      <style>h1 { font-family: "proxima-nova", sans-serif }
      @font-face { font-family: "freight-display-pro"; font-weight: 600;
        src: url("${af}/l?primer=7cd&fvd=n6&v=3") format("woff2"), url("${af}/d?fvd=n6") format("woff"); }</style>`)
    expect(siteFonts(html, home).stylesheets).toEqual([
      { url: 'https://use.typekit.net/abc1def.css', from: 'adobe' },
      { url: 'https://use.typekit.net/xyz9876.css', from: 'adobe' }
    ])
    expect(kinds(html)).toEqual([
      'proxima-nova heading unknown',
      'freight-display-pro - adobe'
    ])
  })

  it('reads heading and body style attributes, var() through custom properties, and the font shorthand', () => {
    const css = `.hero__title { font: italic 700 3.5rem/1.1 var(--brand-display, serif) }
      :root { --brand-display: "Canela Deck"; --size-heading-font: 32px; --input-type: text;
        --typeBasePrimary: Karla; --typeBaseFallback: sans-serif }`
    const body = `<h1 style="font-family: 'Brand Serif', Georgia, serif">Hi</h1><p style="font-family:Nope">x</p>`
    expect(kinds(style(css, body))).toEqual([
      'Canela Deck heading unknown',
      'Brand Serif heading unknown',
      'Karla body unknown'
    ])
    expect(
      kinds('<html><body style="font-family:Brand Sans">x</body></html>')
    ).toEqual(['Brand Sans body unknown'])
  })

  it('leaves out keyword and system families, icon fonts and data: files; keeps a system name the brand serves', () => {
    const html = style(`
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif }
      h1 { font-family: Arial, Helvetica, sans-serif } h2 { font-family: serif } h3 { font-family: inherit }
      @font-face { font-family: "Font Awesome 6 Free"; src: url("/fonts/fa-solid-900.woff2") format("woff2") }
      @font-face { font-family: icomoon; src: url("/fonts/icomoon.ttf") }
      @font-face { font-family: 'slick'; src: url('/fonts/slick.woff') }
      @font-face { font-family: 'Material Icons'; src: url(https://fonts.gstatic.com/s/materialicons/v1/x.woff2) }
      @font-face { font-family: Inline; src: url(data:font/woff2;base64,d09GMgABAAAAA;) format("woff2") }
      @font-face { font-family: "Helvetica Neue"; src: url(/fonts/HelveticaNeue-Roman.woff2) }
      @font-face { font-family: Alias; src: local("Segoe UI"), local(Arial) }
      h4 { font-family: Georgia }`)
    expect(kinds(html)).toEqual([
      'Inline - unknown',
      'Helvetica Neue - self-hosted',
      'Alias - system'
    ])
  })

  it('keeps only https WOFF2, WOFF, TTF and OTF files on public hosts', () => {
    const sources = [
      'https://fonts.example-cdn.com/a.woff2',
      'http://cedarlane.com/b.woff',
      '/c.ttf?v=2',
      '../d.OTF',
      '/e.eot?#iefix',
      '/f.svg#font',
      '/g.css',
      '/h',
      'https://localhost/i.woff2',
      'https://10.0.0.7/j.woff2',
      'https://fonts.internal/k.woff2',
      'https://cdn.cedarlane.com:8443/l.woff2',
      'https://user:pass@cedarlane.com/m.woff2',
      'ftp://cedarlane.com/n.woff2',
      'javascript:alert(1)//o.woff2',
      `https://cedarlane.com/${'p'.repeat(1_000)}.woff2`
    ]
    const css = sources
      .map(
        (u, i) =>
          `@font-face{font-family:Brand;font-weight:${i + 1}00;src:url("${u}")}`
      )
      .join('\n')
    const got = siteFonts(page(''), 'https://cedarlane.com/products/socks', {
      sheets: [{ url: 'https://cedarlane.com/assets/theme.css', css }]
    })
    expect(got.families[0]!.files.map((f) => f.url)).toEqual([
      'https://fonts.example-cdn.com/a.woff2',
      'https://cedarlane.com/b.woff',
      'https://cedarlane.com/c.ttf?v=2',
      'https://cedarlane.com/d.OTF'
    ])
  })

  it('reads the stylesheets passed back (part b) from their own addresses, and refuses unsafe names', () => {
    const html = page(
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
       <style>:root{--font-heading-family:Grove,serif}
         h3{font-family:"Evil\\";} body{x"} h2{font-family:"${'N'.repeat(61)}"} h4{font-family:'Ünïcode'}</style>`
    )
    const sheets = [
      {
        url: 'https://fonts.googleapis.com/css2?family=Inter',
        css: '@font-face{font-family:"Inter";src:url(https://fonts.gstatic.com/s/inter/v13/a.woff2) format("woff2")}'
      },
      {
        url: 'https://cedarlane.com/cdn/shop/t/1/assets/base.css',
        css: 'h1,.h1{font-family:var(--font-heading-family)} @font-face{font-family:Grove;src:url(../fonts/grove.woff2)}'
      }
    ]
    const got = siteFonts(html, home, { sheets })
    expect(kinds(html, sheets)).toEqual([
      'Grove heading self-hosted',
      'Inter - google'
    ])
    expect(got.families.map((f) => f.files[0]!.url)).toEqual([
      'https://cedarlane.com/cdn/shop/t/1/fonts/grove.woff2',
      'https://fonts.gstatic.com/s/inter/v13/a.woff2'
    ])
  })

  it(`keeps at most ${maxFamilies} families, and nothing from a page it cannot read`, () => {
    const many = Array.from(
      { length: 20 },
      (_, i) => `@font-face{font-family:Brand${i};src:url(/f${i}.woff2)}`
    ).join('')
    expect(kinds(style(many))).toHaveLength(maxFamilies)
    expect(siteFonts(style('h1{font-family:X}'), 'not a page')).toEqual({
      families: [],
      stylesheets: []
    })
    expect(
      kinds('<<<style>>>h1{{{font-family:;;;}<link rel=stylesheet href=">')
    ).toEqual([])
  })

  it('reads hostile input in linear time: unclosed CSS, deep nesting, huge values and pages', () => {
    const started = performance.now()
    const face = '@font-face{font-family:Real;src:url(/real.woff2)}'
    for (const css of [
      '{'.repeat(200_000),
      '}'.repeat(200_000),
      'h1{'.repeat(100_000) + 'font-family:Deep}',
      '"'.repeat(200_000),
      `h1{font-family:"${'a'.repeat(400_000)}`,
      '/*'.repeat(100_000),
      '('.repeat(200_000) + ';',
      `h1{font-family:${'var(--x,'.repeat(50_000)}}`,
      `h1{font:${'1px '.repeat(100_000)}}`,
      `@font-face{font-family:A;src:${'url(/a.woff2),'.repeat(30_000)}}`,
      `${'h1,'.repeat(150_000)}h2{font-family:Wide}`
    ])
      expect(
        kinds(page(`<style>${css}</style><style>${face}</style>`))
      ).toContain('Real - self-hosted')
    const deep = `${'<div>'.repeat(6_000)}<h1 style="font-family:Nested">x</h1>`
    expect(kinds(style(face, deep))).toEqual([
      'Nested heading unknown',
      'Real - self-hosted'
    ])
    const big = 'w '.repeat(200_000)
    expect(
      kinds(
        page('', `<h1 style="font-family:Cut;${big}" class="${big}">x</h1>`)
      )
    ).toEqual(['Cut heading unknown'])
    expect(performance.now() - started).toBeLessThan(5_000)
  })
})
