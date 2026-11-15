// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  maxSectionHeight,
  sectionDocument,
  sectionProblems,
  sectionUrls,
  type DesignedSection
} from './section'

const hosts = ['cdn.shop.example', 'fonts.shop.example']
const good: DesignedSection = {
  id: 's2',
  html: '<div class="hero"><img src="https://cdn.shop.example/oak-tray.png" alt="Oak tray"><h1>Slow mornings</h1></div>',
  css: '.hero{background:url("https://cdn.shop.example/linen.jpg") center/cover;height:100%}h1{font:700 44px "Brand Serif"}',
  height: 420,
  fonts: [
    {
      family: 'Brand Serif',
      url: 'https://fonts.shop.example/serif.woff2',
      weight: 700
    }
  ]
}
const with_ = (over: Partial<DesignedSection>) => ({ ...good, ...over })

describe('a designed section (DST-001)', () => {
  it('may be drawn when it runs and loads nothing but its own pictures and fonts', () => {
    expect(sectionProblems(good, hosts)).toEqual([])
    // A small inline picture is a picture too.
    expect(
      sectionProblems(
        with_({
          html: '<img src="data:image/png;base64,iVBORw0KGgo=" alt="">'
        }),
        hosts
      )
    ).toEqual([])
  })

  it.each([
    ['a script', '<script>alert(1)</script>'],
    ['a frame', '<iframe src="https://cdn.shop.example/x"></iframe>'],
    ['a form', '<form><input name="email"></form>'],
    ['a button', '<button>Shop</button>'],
    ['a style element', '<style>h1{color:red}</style>'],
    [
      'a link element',
      '<link rel="stylesheet" href="https://cdn.shop.example/a.css">'
    ],
    ['svg foreign content', '<svg><foreignObject></foreignObject></svg>']
  ])('refuses %s', (_, html) => {
    expect(sectionProblems(with_({ html }), hosts)).toContain(
      'The section has an element a picture never needs (a script, a frame, a form, a link or a style).'
    )
  })

  it('refuses event handlers and links that would run something', () => {
    expect(
      sectionProblems(
        with_({ html: '<img src="x" onerror="alert(1)">' }),
        hosts
      )
    ).toContain('The section has an event handler.')
    for (const html of [
      '<a href="javascript:alert(1)">x</a>',
      '<img src="data:text/html;base64,PHNjcmlwdD4=">'
    ])
      expect(sectionProblems(with_({ html }), hosts)).toContain(
        'The section has a link that would run something.'
      )
  })

  it('refuses styles that load, run or break out', () => {
    for (const css of [
      '@import url("https://cdn.shop.example/a.css");',
      'h1{background-image:image-set("https://evil.example/a.png" 1x)}',
      'h1{width:expression(alert(1))}',
      'h1{color:red}</style><script>alert(1)</script>',
      '@\\69mport "x";'
    ])
      expect(sectionProblems(with_({ css }), hosts)).toContain(
        'The section’s styles load or run something.'
      )
  })

  it('loads only https pictures and fonts from its hosts', () => {
    const problems = sectionProblems(
      with_({
        html: '<img src="http://cdn.shop.example/a.png"><img srcset="https://cdn.shop.example/a.png 1x, https://evil.example/b.png 2x"><div style="background:url(https://evil.example/c.png)"></div>',
        css: 'h1{background:url(//evil.example/d.png)}',
        fonts: [{ family: 'Brand Serif', url: 'https://evil.example/f.woff2' }]
      }),
      hosts
    )
    expect(problems).toEqual(
      expect.arrayContaining([
        'The section loads http://cdn.shop.example/a.png, which is not one of its pictures.',
        'The section loads https://evil.example/b.png, which is not one of its pictures.',
        'The section loads https://evil.example/c.png, which is not one of its pictures.',
        'The section loads //evil.example/d.png, which is not one of its pictures.',
        'The font Brand Serif is not on its hosts.'
      ])
    )
  })

  it('has a usable name, height, size and fonts', () => {
    expect(
      sectionProblems(
        with_({
          id: 's 2"',
          height: maxSectionHeight + 1,
          html: 'x'.repeat(60_001),
          fonts: [
            ...Array.from({ length: 5 }, () => good.fonts![0]),
            {
              family: 'Bad"Name',
              url: 'https://fonts.shop.example/a.woff2',
              weight: 950
            }
          ]
        }),
        hosts
      )
    ).toEqual(
      expect.arrayContaining([
        'The section has no usable name.',
        'A section is 40 to 1600 px tall.',
        'The section’s markup is too long.',
        'A section uses at most 4 web fonts.',
        'A font has no usable name.',
        'The font Bad"Name has no usable weight.'
      ])
    )
  })

  it('finds every link it loads', () => {
    expect(
      sectionUrls({
        html: `<img src='a.png'><image href=b.png></image><img srcset="c.png 1x, d.png 2x"><p style="background:url('e.png')"></p>`,
        css: 'p{background:url(f.png)}'
      })
    ).toEqual(['a.png', 'b.png', 'c.png', 'd.png', 'f.png', 'e.png'])
  })

  it('becomes one page: its fonts, a 600 px frame of its height, its styles and markup', () => {
    const page = sectionDocument(good)
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).toContain(
      '@font-face{font-family:"Brand Serif";src:url("https://fonts.shop.example/serif.woff2");font-weight:700;font-style:normal;font-display:block}'
    )
    expect(page).toContain(
      '#gr-section{position:relative;width:600px;height:420px;overflow:hidden}'
    )
    expect(page).toContain(`${good.css}</style>`)
    expect(page).toContain(`<div id="gr-section">${good.html}</div>`)
  })
})
