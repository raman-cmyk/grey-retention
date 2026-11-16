import { describe, expect, it } from 'vitest'
import {
  maxDepth,
  maxFamilies,
  maxFontFiles,
  maxStylesheets,
  siteFonts
} from './fonts'

type Sheets = { url: string; css: string }[]
const home = 'https://cedarlane.com/'
const shop = '//cedarlane.com/cdn/fonts'
const page = (head: string, body = '') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`
const style = (css: string, body = '') => page(`<style>${css}</style>`, body)
/** Each family as "name roles kind". */
const kinds = (html: string, sheets?: Sheets) =>
  siteFonts(html, home, { sheets }).families.map(
    (f) => `${f.family} ${f.roles.join('+') || '-'} ${f.kind}`
  )
/** Each stylesheet as "from url". */
const listed = (html: string, sheets?: Sheets) =>
  siteFonts(html, home, { sheets }).stylesheets.map((s) => `${s.from} ${s.url}`)
const link = (href: string, rel = 'stylesheet') =>
  `<link rel="${rel}" href="${href}">`
const time = (run: () => unknown) => {
  const started = performance.now()
  run()
  return performance.now() - started
}

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
    expect(JSON.stringify(got.families[0]!.files)).toBe(
      `[{"url":"https:${shop}/playfair/playfair_display_i4.woff2","format":"woff2","weight":400,"maxWeight":900,"italic":true}]`
    )
    expect(
      got.families[1]!.files.map((f) => `${f.format} ${f.weight} ${f.italic}`)
    ).toEqual(['woff2 400 false', 'woff 400 false', 'woff2 700 false'])
    expect(listed(html)).toEqual([
      'site https://cedarlane.com/cdn/shop/t/12/assets/base.css?v=1'
    ])
  })

  it('names Google Fonts families from css2, css and @import links, never icon fonts', () => {
    const css2 =
      'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,700&family=Inter:wght@400;600&family=Ubuntu&display=swap'
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
      'Ubuntu - google',
      'Lato - google',
      'Open Sans - google'
    ])
    expect(listed(html).map((s) => s.split(' ')[0])).toEqual([
      'google',
      'google'
    ])
    expect(listed(html)[0]).toBe(`google ${new URL(css2).href}`)
  })

  it('keeps Google’s Latin files only, at most two per weight and style, and at most 12 in all', () => {
    // Google's own order: each weight's other scripts first, Latin last.
    const face = (w: number, name: string, range: string) =>
      `/* ${name} */ @font-face { font-family: 'Inter'; font-weight: ${w}; unicode-range: ${range};
        src: url(https://fonts.gstatic.com/s/inter/v13/${name}-${w}.woff2) format('woff2'); }`
    const css = [400, 600]
      .map((w) =>
        [
          face(w, 'cyrillic-ext', 'U+0460-052F'),
          face(w, 'latin-ext', 'U+0100-02BA, U+1E00-1E9F'),
          face(w, 'latin', 'U+0000-00FF, U+0131')
        ].join('')
      )
      .join('')
    const google = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600'
    const got = siteFonts(page(link(google)), home, {
      sheets: [{ url: google, css }]
    })
    expect(got.families[0]!.files.map((f) => f.url.split('/').pop())).toEqual([
      'latin-400.woff2',
      'latin-600.woff2'
    ])
    const many = Array.from(
      { length: 20 },
      (_, i) =>
        `@font-face{font-family:Brand;font-weight:${100 + (i % 9) * 100};src:url(/b${i}.woff2),url(/b${i}.woff),url(/b${i}.ttf)}`
    ).join('')
    const files = siteFonts(style(many), home).families[0]!.files
    expect(files).toHaveLength(maxFontFiles)
    expect(files.filter((f) => f.weight === 100)).toHaveLength(2)
  })

  it('lists Google, Adobe and font CDNs before the brand’s own stylesheets, and only its own hosts', () => {
    const own = Array.from({ length: 14 }, (_, i) => link(`/s${i}.css`)).join(
      ''
    )
    const crowded = listed(
      page(
        `${own}${link('https://fonts.googleapis.com/css2?family=Inter')}${link('https://use.typekit.net/abc1def.css')}`
      )
    )
    expect(crowded).toHaveLength(maxStylesheets)
    expect(crowded.slice(0, 3)).toEqual([
      'google https://fonts.googleapis.com/css2?family=Inter',
      'adobe https://use.typekit.net/abc1def.css',
      'site https://cedarlane.com/s0.css'
    ])
    const html = page(
      [
        link('https://cedarlane.com.evil.com/a.css'),
        link('https://evilcedarlane.com/a.css'),
        link('https://shop.cedarlane.com/a.css'),
        link('https://cdn.shopify.com/s/files/1/theme.css'),
        link('/preloaded.css', 'preload" as="style'),
        link('/f.woff2', 'preload" as="font'),
        link('https://fonts.bunny.net/css?family=inter:400'),
        link(`/${'x'.repeat(1_000)}.css`)
      ].join('')
    )
    expect(listed(html)).toEqual([
      'cdn https://fonts.bunny.net/css?family=inter:400',
      'site https://shop.cedarlane.com/a.css',
      'site https://cdn.shopify.com/s/files/1/theme.css',
      'site https://cedarlane.com/preloaded.css'
    ])
    const base = 'https://cedarlane.com/cdn/shop/t/1/assets/base.css'
    const imports = `@import url(fonts.css); @import url("https://fonts.googleapis.com/css2?family=${'A'.repeat(1_000)}");
      @media (min-width: 750px) { @font-face { font-family: Wide; src: url(../fonts/wide.woff2) } }`
    expect(listed(page(''), [{ url: base, css: imports }])).toEqual([
      'site https://cedarlane.com/cdn/shop/t/1/assets/fonts.css'
    ])
    expect(
      siteFonts(page(''), home, { sheets: [{ url: base, css: imports }] })
        .families[0]!.files[0]!.url
    ).toBe('https://cedarlane.com/cdn/shop/t/1/fonts/wide.woff2')
  })

  it('lists an Adobe Fonts kit (its families are in its stylesheet) and reads Adobe files', () => {
    const af = 'https://use.typekit.net/af/2d6f0b/00000000003b9b0939/27'
    const html =
      page(`<link rel="StyleSheet" href="https://use.typekit.net/abc1def.css">
      <script src="//use.typekit.net/xyz9876.js"></script>
      <style>h1 { font-family: "proxima-nova", sans-serif }
      @font-face { font-family: "freight-display-pro"; font-weight: 600;
        src: url("${af}/l?primer=7cd&fvd=n6&v=3") format("woff2"), url("${af}/d?fvd=n6") format("woff"); }</style>`)
    expect(listed(html)).toEqual([
      'adobe https://use.typekit.net/abc1def.css',
      'adobe https://use.typekit.net/xyz9876.css'
    ])
    expect(kinds(html)).toEqual([
      'proxima-nova heading unknown',
      'freight-display-pro - adobe'
    ])
  })

  it('reads style attributes, var() through custom properties and the font shorthand; never a value that is no font', () => {
    const css = `.hero__title { font: italic 700 3.5rem/1.1 var(--brand-display, serif) }
      :root { --brand-display: "Canela Deck"; --size-heading-font: 32px; --input-type: text;
        --typeBasePrimary: Karla; --typeBaseFallback: sans-serif; --typeCollectionTitle: 20px;
        --font-display: swap; --font-heading-align: center; --font-heading-alt: 2rem }
      .h2 { font: 600 calc(1rem + 2vw) / 1.2 "Calc Serif" } .h3 { font: var(--s)/1.1 Var Sans }
      .h4 { font: bold larger Keyword Sans, serif } p:not(h1) { font-family: Not Heading }
      h5 { font-family: Spaced ! important } h6::before { content: "/*" } h6 { font-family: After Quote }`
    const body = `<h1 style="font-family: 'Brand Serif', Georgia, serif">Hi</h1><p style="font-family:Nope">x</p>
      <h2 style="${'color:red;'.repeat(48)}font-family:Playfair Display">cut</h2>`
    expect(kinds(style(css, body))).toEqual([
      'Canela Deck heading unknown',
      'Calc Serif heading unknown',
      'Var Sans heading unknown',
      'Keyword Sans heading unknown',
      'Spaced heading unknown',
      'After Quote heading unknown',
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
      @font-face { font-family: feather; src: url('/fonts/feather.woff') }
      @font-face { font-family: 'Material Icons'; src: url(https://fonts.gstatic.com/s/materialicons/v1/x.woff2) }
      @font-face { font-family: Inline; src: url(data:font/woff2;base64,d09GMgABAAAAA;) format("woff2") }
      @font-face { font-family: "Helvetica Neue"; src: url(/fonts/HelveticaNeue-Roman.woff2) }
      @font-face { font-family: Alias; src: local("Segoe UI"), local(Arial) }
      @font-face { font-family: "Lone Star"; src: url(/fonts/lone-star.woff2) }
      h4 { font-family: Georgia }`)
    expect(kinds(html)).toEqual([
      'Inline - unknown',
      'Helvetica Neue - self-hosted',
      'Alias - system',
      'Lone Star - self-hosted'
    ])
  })

  it('keeps only https WOFF2, WOFF, TTF and OTF files on public hosts, read from their own stylesheet', () => {
    const sources =
      `https://fonts.example-cdn.com/a.woff2 http://cedarlane.com/b.woff /c.ttf?v=2 ../d.OTF /e.eot?#iefix /f.svg#font /g.css /h https://localhost/i.woff2 https://10.0.0.7/j.woff2 https://fonts.internal/k.woff2 https://cdn.cedarlane.com:8443/l.woff2 https://user:pass@cedarlane.com/m.woff2 ftp://cedarlane.com/n.woff2 javascript:alert(1)//o.woff2 https://cedarlane.com/${'p'.repeat(1_000)}.woff2`.split(
        ' '
      )
    const css = sources
      .map(
        (u, i) =>
          `@font-face{font-family:Brand;font-weight:${i + 1}00;src:url("${u}")}`
      )
      .join('\n')
    const got = siteFonts(page(''), 'https://cedarlane.com/products/socks', {
      sheets: [{ url: 'https://cedarlane.com/assets/theme.css', css }]
    })
    expect(got.families[0]!.files.map((f) => f.url).join(' ')).toBe(
      'https://fonts.example-cdn.com/a.woff2 https://cedarlane.com/b.woff https://cedarlane.com/c.ttf?v=2 https://cedarlane.com/d.OTF'
    )
    // A relative file is the page's when inline, its stylesheet's host's when passed back.
    const face = '@font-face{font-family:Base;src:url(fonts/b.woff2)}'
    expect(kinds(style(face))).toEqual(['Base - self-hosted'])
    expect(
      kinds(page(''), [{ url: 'https://assets.internal/theme.css', css: face }])
    ).toEqual(['Base - unknown'])
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
    expect(kinds(html, sheets)).toEqual([
      'Grove heading self-hosted',
      'Inter - google'
    ])
    expect(
      siteFonts(html, home, { sheets }).families.map((f) => f.files[0]!.url)
    ).toEqual([
      'https://cedarlane.com/cdn/shop/t/1/fonts/grove.woff2',
      'https://fonts.gstatic.com/s/inter/v13/a.woff2'
    ])
  })

  it(`keeps at most ${maxFamilies} families, reads ${maxDepth} levels deep, and nothing from a page it cannot read`, () => {
    const many = Array.from(
      { length: 20 },
      (_, i) => `@font-face{font-family:Brand${i};src:url(/f${i}.woff2)}`
    ).join('')
    expect(kinds(style(many))).toHaveLength(maxFamilies)
    const nested = (n: number, family: string) =>
      `<style>${'@media all{'.repeat(n - 1)}h1{font-family:${family}}</style>`
    expect(
      kinds(page(nested(maxDepth, 'Deepest') + nested(maxDepth + 1, 'Deeper')))
    ).toEqual(['Deepest heading unknown'])
    expect(siteFonts(style('h1{font-family:X}'), 'not a page')).toEqual({
      families: [],
      stylesheets: []
    })
    expect(
      kinds('<<<style>>>h1{{{font-family:;;;}<link rel=stylesheet href=">')
    ).toEqual([])
  })

  it('reads hostile input in linear time: each case well within its budget', () => {
    const face = '@font-face{font-family:Real;src:url(/real.woff2)}'
    // One long selector, its body split by 124,000 nested rules (once 6.8 s).
    const split = `${'a'.repeat(2_000)}{${';a{}'.repeat(124_000)}}`
    for (const css of [
      split,
      `@font-face{${';a{}'.repeat(124_000)}}`,
      '{'.repeat(200_000),
      '}'.repeat(200_000),
      'h1{'.repeat(100_000) + 'font-family:Deep}',
      '"'.repeat(200_000),
      `h1{font-family:"${'a'.repeat(400_000)}`,
      '/*'.repeat(100_000),
      '"/*"'.repeat(100_000),
      '('.repeat(200_000) + ';',
      `h1{font-family:${'var(--x,'.repeat(50_000)}}`,
      `h1{font:${'1px '.repeat(100_000)}}`,
      `@font-face{font-family:A;src:${'url(/a.woff2),'.repeat(30_000)}}`,
      `${'h1,'.repeat(150_000)}h2{font-family:Wide}`,
      `${':not(a'.repeat(80_000)}{font-family:X}`
    ]) {
      let got: string[] = []
      const html = page(`<style>${css}</style><style>${face}</style>`)
      expect(time(() => (got = kinds(html)))).toBeLessThan(1_000)
      expect(got).toContain('Real - self-hosted')
    }
    // The worst whole call: four such blocks and 12 sheets, cut at 2 million characters.
    const sheets = Array.from({ length: 12 }, () => ({ url: home, css: split }))
    const four = page(`<style>${split}</style>`.repeat(4))
    expect(time(() => siteFonts(four, home, { sheets }))).toBeLessThan(3_000)
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
  })
})
