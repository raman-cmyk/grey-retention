// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  maxSectionHeight,
  minPictureTextPx,
  sectionDocument,
  sectionProblems,
  sectionUrls,
  srcsetUrls,
  type DesignedSection
} from './section'

const hosts = ['cdn.shop.example', 'fonts.shop.example']
const good: DesignedSection = {
  id: 's2',
  html: '<div class="hero"><img src="https://cdn.shop.example/oak-tray.png" alt="Oak tray"><h1>Slow mornings</h1><svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><symbol id="leaf"><path d="M0 0h10"/></symbol></defs><rect width="10" height="10" fill="url(#g)"/><use href="#leaf"/></svg></div>',
  css: '.hero{background:url("https://cdn.shop.example/linen.jpg") center/cover;height:100%}h1{font:700 44px "Brand Serif"}.data:hover{opacity:1}',
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
const loads = (url: string) =>
  `The section loads ${url}, which is not one of its pictures.`

describe('a designed section (DST-001)', () => {
  it('may be drawn when it runs and loads nothing but its own pictures, fonts and inner references', () => {
    expect(sectionProblems(good, hosts)).toEqual([])
    expect(
      sectionProblems(
        with_({
          html: '<p>Your data: safe. Learn javascript: the basics.</p><img src="data:image/png;base64,iVBORw0KGgo=" alt="">'
        }),
        hosts
      )
    ).toEqual([])
  })

  it.each([
    ['a script', '<script>alert(1)</script>', 'script'],
    ['a frame', '<iframe src="https://cdn.shop.example/x"></iframe>', 'iframe'],
    ['a form', '<form><input name="email"></form>', 'form'],
    ['a button', '<button>Shop</button>', 'button'],
    ['a link (a)', '<a href="https://cdn.shop.example/">Shop</a>', 'a'],
    ['a style element', '<style>h1{color:red}</style>', 'style'],
    [
      'a link element',
      '<link rel="stylesheet" href="https://cdn.shop.example/a.css">',
      'link'
    ],
    [
      'a picture element',
      '<picture><source srcset="https://evil.example/x.png"></picture>',
      'picture'
    ],
    ['a video', '<video poster="https://evil.example/x.png"></video>', 'video'],
    [
      'SVG animation',
      '<svg><image href="https://cdn.shop.example/a.png"><set attributeName="href" to="https://evil.example/x.png"/></image></svg>',
      'set'
    ],
    [
      'SVG foreign content',
      '<svg><foreignObject></foreignObject></svg>',
      'foreignobject'
    ]
  ])('refuses %s', (_, html, tag) => {
    expect(sectionProblems(with_({ html }), hosts)).toContain(
      `The section has a <${tag}>, which a picture never needs.`
    )
  })

  it('refuses event handlers, however they are written', () => {
    for (const html of [
      '<img src="https://cdn.shop.example/a.png" onerror="alert(1)">',
      '<img src="https://cdn.shop.example/a.png" alt="a>" onerror="alert(1)">',
      '<img src="https://cdn.shop.example/a.png"/onerror="alert(1)">',
      '<svg><rect ONLOAD="x"/></svg>'
    ])
      expect(sectionProblems(with_({ html }), hosts)).toContain(
        'The section has an event handler.'
      )
  })

  it('reads attributes as the browser does: no space, a slash, entities, a srcset without spaces', () => {
    const evil = 'https://evil.example/x.png'
    for (const html of [
      `<img/src="${evil}">`,
      `<img alt="x"src="${evil}">`,
      `<img src="&#104;ttps://evil.example/x.png">`,
      `<img srcset="https://cdn.shop.example/a.png 1x,${evil} 2x">`,
      `<svg><image href="${evil}"/></svg>`,
      `<svg><image xlink:href="${evil}"/></svg>`
    ])
      expect(sectionProblems(with_({ html }), hosts)).toContain(loads(evil))
  })

  it('checks inline styles and attributes like the styles: image-set, escapes, entities, url()', () => {
    for (const html of [
      `<div style="background-image:image-set('https://evil.example/x.png' 1x)"></div>`,
      `<div style="background-image:-webkit-image-set('https://evil.example/x.png' 1x)"></div>`,
      `<div style="background-image:\\75rl(https://evil.example/x.png)"></div>`
    ])
      expect(sectionProblems(with_({ html }), hosts)).toContain(
        'The section’s inline styles load or run something.'
      )
    expect(
      sectionProblems(
        with_({
          html: '<div style="background-image:url&#40;https://evil.example/x.png&#41;"></div><svg><rect fill="url(https://evil.example/y.png)"/></svg>'
        }),
        hosts
      )
    ).toEqual(
      expect.arrayContaining([
        loads('https://evil.example/x.png'),
        loads('https://evil.example/y.png')
      ])
    )
  })

  it('refuses styles that load, run or break out, and fonts outside its list', () => {
    for (const css of [
      '@import url("https://cdn.shop.example/a.css");',
      '@font-face{font-family:x;src:url(https://fonts.shop.example/x.woff2)}',
      'h1{background-image:image-set("https://evil.example/a.png" 1x)}',
      'h1{width:expression(alert(1))}',
      'h1{color:red}</style><script>alert(1)</script>',
      '@\\69mport "x";'
    ])
      expect(sectionProblems(with_({ css }), hosts)).toContain(
        'The section’s styles load or run something.'
      )
  })

  it('loads only https pictures and fonts from its hosts, with no port', () => {
    expect(
      sectionProblems(
        with_({
          html: '<img src="http://cdn.shop.example/a.png"><img src="https://cdn.shop.example:8443/a.png">',
          css: 'h1{background:url(//evil.example/d.png)}',
          fonts: [
            { family: 'Brand Serif', url: 'https://evil.example/f.woff2' }
          ]
        }),
        hosts
      )
    ).toEqual(
      expect.arrayContaining([
        loads('http://cdn.shop.example/a.png'),
        loads('https://cdn.shop.example:8443/a.png'),
        loads('//evil.example/d.png'),
        'The font Brand Serif is not on its hosts.'
      ])
    )
    expect(
      sectionProblems(
        with_({
          html: '<svg><use href="https://evil.example/s.svg#x"/></svg>'
        }),
        hosts
      )
    ).toContain(
      'A link in the section goes somewhere: only an SVG <use> may point inside it.'
    )
  })

  it('refuses unknown attributes and a section in the wrong shape, without throwing', () => {
    expect(
      sectionProblems(
        with_({
          html: '<img src="https://cdn.shop.example/a.png" ping="https://evil.example/">'
        }),
        hosts
      )
    ).toContain(
      'The section uses the attribute ping, which a picture never needs.'
    )
    for (const bad of [
      { ...good, html: undefined },
      { ...good, css: null },
      { ...good, fonts: [{ family: 7, url: 'x' }] },
      null,
      'section'
    ])
      expect(sectionProblems(bad, hosts)).toEqual([
        'The section is not in the shape a section has.'
      ])
  })

  it('has a usable name, height, size and fonts, and stops early when too long', () => {
    expect(
      sectionProblems(
        with_({
          id: 's 2"',
          height: maxSectionHeight + 1,
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
        'A section uses at most 4 web fonts.',
        'A font has no usable name.',
        'The font Bad"Name has no usable weight.'
      ])
    )
    const started = Date.now()
    expect(
      sectionProblems(with_({ html: '<'.repeat(180_000) }), hosts)
    ).toEqual(['The section’s markup is too long.'])
    expect(sectionProblems(with_({ html: '<'.repeat(60_000) }), hosts)).toEqual(
      []
    )
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('reads a srcset as the HTML standard does', () => {
    expect(srcsetUrls('a.png 1x,b.png 2x')).toEqual(['a.png', 'b.png'])
    expect(srcsetUrls(' a.png,  b.png 600w , c.png')).toEqual([
      'a.png',
      'b.png',
      'c.png'
    ])
    expect(srcsetUrls('data:image/png;base64,AAAA 1x')).toEqual([
      'data:image/png;base64,AAAA'
    ])
  })

  it('lists every link it loads, without its inner references', () => {
    expect(sectionUrls(good, hosts)).toEqual([
      'https://cdn.shop.example/linen.jpg',
      'https://cdn.shop.example/oak-tray.png',
      'https://fonts.shop.example/serif.woff2'
    ])
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

describe('typography in a designed section (DST-PIC #11)', () => {
  const sized = (css: string, html = '<h1>Hi</h1>') =>
    sectionProblems(with_({ css, html }), hosts).filter((p) =>
      p.includes('type sizes')
    )
  it('takes at most three type sizes, however they are written', () => {
    expect(
      sized('h1{font-size:48px}p{font-size:18px}small{font-size:12px}')
    ).toEqual([])
    // The same size twice, and a bare weight in the shorthand, count once.
    expect(
      sized(
        'h1{font:700 48px/1.1 Georgia,serif}h2{font-size:48.0px}p{font-size:18px !important}small{font-size:12px}'
      )
    ).toEqual([])
    expect(
      sized(
        'h1{font-size:48px}h2{font-size:32px}p{font-size:18px}small{font-size:12px}'
      )
    ).toEqual([
      'The section uses 4 type sizes; use at most 3 (a headline, a line under it and a small label).'
    ])
  })

  it('counts the sizes in inline styles, the shorthand and SVG text too', () => {
    expect(
      sized(
        'h1{font-size:48px}',
        '<h1>Hi</h1><p style="font: italic 20px Georgia">Line</p><small style="font-size:12px">x</small><svg viewBox="0 0 10 10"><text font-size="9">A</text></svg>'
      )
    ).toEqual([
      'The section uses 4 type sizes; use at most 3 (a headline, a line under it and a small label).'
    ])
  })
})

describe('a designed section on a phone (DST-PIC #16)', () => {
  const small = (css: string) =>
    sectionProblems(
      with_({ css, html: '<h1>Hi</h1><p>Line</p>' }),
      hosts
    ).filter((p) => p.includes('on a phone'))
  it('refuses text a phone would show under 14 px (23 px or more at 600)', () => {
    expect(minPictureTextPx).toBe(23)
    expect(small('h1{font-size:48px}p{font-size:23px}')).toEqual([])
    expect(small('h1{font-size:48px}p{font-size:16px}')).toEqual([
      'Text set at 16 px shows at 10 px on a phone: set text at 23 px or more (14 px on a phone).'
    ])
    // Other units, read on 16 px, and the shorthand.
    expect(small('p{font-size:1.5em}')).toEqual([])
    expect(small('p{font:italic 12pt Georgia}')).toEqual([
      'Text set at 16 px shows at 10 px on a phone: set text at 23 px or more (14 px on a phone).'
    ])
    expect(small('p{font-size:small}')).toEqual([
      'Text set at 13 px shows at 8.1 px on a phone: set text at 23 px or more (14 px on a phone).'
    ])
    // A size it cannot know (calc, smaller) is left to the critic's phone view.
    expect(small('p{font-size:calc(1em + 2px)}h1{font-size:smaller}')).toEqual(
      []
    )
  })
})
