// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  designedFrom,
  designProblems,
  readMarkup,
  sectionAlt,
  type DesignAnswer,
  type SectionBrief
} from './designer'
import { sectionProblems } from './section'

const photo = 'https://cdn.shop.example/images/p-cedar-tray.jpg'
const brief: SectionBrief = {
  mode: 'scratch',
  slot: { emailType: 'launch', angle: 'The new tray is here' },
  board: {
    id: 's2',
    render: 'designed',
    tone: 'dark',
    height: 640,
    focus: 'The new tray',
    imagery: 'product',
    space: 'airy',
    note: 'The tray large on the right, the words on the left.'
  },
  family: 'hero_product',
  words: {
    eyebrow: 'Just in',
    headline: 'Meet the cedar tray',
    sub: 'Hand-finished, made to last.'
  },
  image: { url: photo, alt: 'A cedar tray on a table' },
  product: { title: 'Cedar tray' },
  brand: {
    name: 'Grove & Co',
    font: 'Poppins',
    ink: '#1a1a1a',
    background: '#f6f3ee',
    accent: '#c2410c',
    dark: '#1f2933'
  },
  fonts: []
}
const good: DesignAnswer = {
  html: [
    '<div class="panel">',
    '<svg class="arc" viewBox="0 0 600 640" aria-hidden="true"><title>An arc</title><circle cx="460" cy="320" r="260" fill="#c2410c" opacity="0.25"/></svg>',
    `<img class="tray" src="${photo}" alt="">`,
    '<p class="eyebrow">Just in</p>',
    '<h1>Meet the <span>cedar</span><br>tray!</h1>',
    '<p class="sub">Hand-finished, made to last</p>',
    '</div>'
  ].join(''),
  css: '.panel{position:absolute;inset:0;background:linear-gradient(160deg,#1f2933,#111827)}.tray{position:absolute;right:-20px;top:80px;width:360px}h1{font:600 56px Poppins,Arial,sans-serif;color:#fff;text-transform:uppercase}.eyebrow::before{content:""}.content:hover{color:#fff}'
}
const html = (body: string) => ({
  ...good,
  html: `<img src="${photo}" alt=""><h1>Meet the cedar tray</h1>${body}`
})
describe('the Section designer’s checks (DST-003b)', () => {
  it('a section drawn from the words and photo given passes, with the storyboard’s size and the words as its alt', () => {
    expect(designProblems(good, brief)).toEqual([])
    const section = designedFrom(good, brief)
    expect(section).toMatchObject({ id: 's2', height: 640, fonts: [] })
    expect(sectionProblems(section, ['cdn.shop.example'])).toEqual([])
    expect(sectionAlt(good, brief)).toBe(
      'Just in. Meet the cedar tray. Hand-finished, made to last.'
    )
    // An SVG title is not drawn; a line break splits words, a span does not.
    expect(readMarkup(good.html).text).toBe(
      'Just in Meet the cedar tray! Hand-finished, made to last'
    )
    expect(
      designProblems(
        html('<p><span class="d">G</span>rove &amp; Co <b>Cedar</b> tray</p>'),
        brief
      )
    ).toEqual([])
  })

  it.each([
    ['a button', '<p>Shop now</p>', 'Shop now'],
    ['a price', '<p>$24</p>', '$24'],
    ['a percent in an entity', '<p>20&#37; off</p>', '20% off'],
    ['part of a line', '<p>made to last</p>', 'made to last'],
    ['SVG text', '<svg><text x="0" y="20">SALE</text></svg>', 'sale'],
    ['a star rating', '<p>★★★★★</p>', '★★★★★']
  ])('refuses words the copy does not have: %s', (_, body, quoted) => {
    expect(designProblems(html(body), brief)).toEqual([
      expect.stringContaining(`draws “${quoted.toLowerCase()}”`)
    ])
  })

  it('takes the product’s and the brand’s names, in any case and order, however the words split, and asks for the headline', () => {
    expect(
      designProblems(html('<p>GROVE &amp; CO</p><b>Cedar tray</b>'), brief)
    ).toEqual([])
    // "Grove" then "Tray season is here", not "Grove Tray" then "season is here".
    const overlap = {
      ...brief,
      brand: { ...brief.brand, name: 'Grove' },
      product: { title: 'Grove Tray' },
      words: { headline: 'Tray season is here' }
    }
    expect(
      designProblems(
        {
          ...good,
          html: `<img src="${photo}" alt=""><p>Grove</p><h1>Tray season is here</h1>`
        },
        overlap
      )
    ).toEqual([])
    expect(
      designProblems(
        { ...good, html: `<img src="${photo}" alt=""><p>Just in</p>` },
        brief
      )
    ).toEqual(['Draw the headline, whole.'])
    for (const hidden of ['\u200b', '\ufeff'])
      expect(
        designProblems(html(`<p>Just${hidden}in</p>`), brief)
      ).toContainEqual('The words have hidden characters in them.')
  })

  it.each([
    // The review's: after a nested rule, a url( inside a string, attr().
    ['h1::after{x{}content:" 20% OFF"}', /content/],
    ['h2{font-family:"url("}h1::after{content:" CODE SAVE20"}', /content/],
    ['li{list-style-type:attr(aria-label)}', /list-style-type/],
    ['ul{list-style-type:decimal}', /list-style-type/],
    ['p{display:list-item;counter-set:list-item 2025}', /display: list-item/],
    ['h1{text-emphasis-style:"$"}', /text-emphasis-style/],
    ['p{display:none}', /display: none/]
  ])('refuses styles that draw or hide words: %s', (css, problem) => {
    expect(designProblems({ ...good, css }, brief).join(' ')).toMatch(problem)
  })

  it('reads each inline style on its own, so one cannot hide another’s', () => {
    const splice = {
      css: 'h2{font-family:"url("}h1::after{content:" CODE SAVE20"}',
      html: `<img src="${photo}" alt="" style="width:calc(10%)"><h1>Meet the cedar tray</h1>`
    }
    expect(designProblems(splice, brief).join(' ')).toMatch(/content/)
    expect(
      designProblems(
        html('<p style="content:&quot;SALE&quot;">Cedar tray</p>'),
        brief
      ).join(' ')
    ).toMatch(/content/)
  })

  it('refuses numbers from a list', () => {
    for (const body of [
      '<ol><li>Cedar tray</li></ol>',
      '<ul><li type="1">Cedar tray</li></ul>'
    ])
      expect(designProblems(html(body), brief)).toContainEqual(
        'A numbered list or a list type draws numbers the copy does not have.'
      )
    expect(designProblems(html('<ul><li>Cedar tray</li></ul>'), brief)).toEqual(
      []
    )
  })

  it('takes the photo as a quoted CSS background, and font tags', () => {
    expect(
      designProblems(
        {
          html: '<div class="bg"></div><h1>Meet the cedar tray</h1>',
          css: `.bg{position:absolute;inset:0;background:url("${photo}") center/cover}h1{font-variation-settings:"wght" 650}`
        },
        brief
      )
    ).toEqual([])
  })

  it('places only the photo given, with an empty alt', () => {
    const other = 'https://cdn.shop.example/images/other.jpg'
    expect(
      designProblems(html(`<img src="${other}" alt="">`), brief)
    ).toContainEqual('Place only the photo given: no other picture.')
    expect(
      designProblems(
        html('<img src="data:image/png;base64,iVBORw0KGgo=" alt="">'),
        brief
      )
    ).toContainEqual('Place only the photo given: no other picture.')
    expect(
      designProblems({ ...good, html: '<h1>Meet the cedar tray</h1>' }, brief)
    ).toEqual([
      'Show the product: place the photo given (an <img> or a background).'
    ])
    expect(
      designProblems(
        { ...good, html: '<h1>Meet the cedar tray</h1>' },
        {
          ...brief,
          family: 'hero_image',
          product: undefined
        }
      )
    ).toEqual([
      'Show the store’s photo: place the photo given (an <img> or a background).'
    ])
    expect(
      designProblems(
        { ...good, html: good.html.replace('alt=""', 'alt="50% off"') },
        brief
      )
    ).toContainEqual(
      'Give each <img> an empty alt (alt=""): the email gives the picture its alt text.'
    )
  })

  it('loads the brand’s web fonts its styles name, and no other', () => {
    const serif = {
      family: 'Grove Serif',
      url: 'https://fonts.shop.example/grove.woff2',
      weight: 600
    }
    const sans = {
      family: 'Grove Sans',
      url: 'https://fonts.shop.example/s.woff2'
    }
    const withFonts = { ...brief, fonts: [serif, sans] }
    const answer = {
      ...good,
      css: `${good.css}h1{font-family:"Grove Serif",Georgia,serif}`
    }
    expect(designProblems(answer, withFonts)).toEqual([])
    expect(designedFrom(answer, withFonts).fonts).toEqual([serif])
    // A font named that is not a web font given loads nothing.
    expect(designedFrom(good, withFonts).fonts).toEqual([])
    // The font shorthand, an SVG font-family, and only the exact name.
    for (const named of [
      {
        css: 'h1{font:600 56px "Grove  Serif",Georgia,serif}',
        html: good.html
      },
      {
        css: '',
        html: `${good.html}<svg><text font-family="Grove Serif">Cedar tray</text></svg>`
      }
    ])
      expect(designedFrom(named, withFonts).fonts).toEqual([serif])
    expect(
      designedFrom(
        { ...good, css: 'h1{font-family:"Open Grove Serif"}' },
        withFonts
      ).fonts
    ).toEqual([])
  })

  it('refuses text an SVG title or description holds for a <use> to draw', () => {
    for (const tag of ['title', 'desc'])
      expect(
        designProblems(
          html(
            `<svg width="600" height="200"><${tag}><svg><text id="t" x="10" y="80">SALE 50% OFF</text></svg></${tag}><use href="#t"/></svg>`
          ),
          brief
        )
      ).toContainEqual('An SVG title or description holds plain text only.')
    // A plain-text title draws nothing.
    expect(
      designProblems(html('<svg><title>An arc</title></svg>'), brief)
    ).toEqual([])
  })

  it('refuses SVG text placed letter by letter, and takes lines of it', () => {
    expect(
      designProblems(
        html('<svg><text x="10 40 70 100" y="50">Cedar tray</text></svg>'),
        brief
      )
    ).toContainEqual(
      'Place SVG text as whole lines: one x, y, dx, dy or rotate each, never letter by letter.'
    )
    expect(
      designProblems(
        {
          ...good,
          html: `<img src="${photo}" alt=""><svg width="600" height="200"><text><tspan x="0" y="60">Meet the</tspan><tspan x="0" y="130">cedar tray</tspan></text></svg>`
        },
        brief
      )
    ).toEqual([])
    // Lines as spans made blocks by the styles.
    expect(
      designProblems(
        {
          html: `<img src="${photo}" alt=""><h1><span class="l">Meet the</span><span class="l">cedar tray</span></h1>`,
          css: '.l{display:block}'
        },
        brief
      )
    ).toEqual([])
  })

  it('finds the headline however the names overlap', () => {
    const overlap = {
      ...brief,
      brand: { ...brief.brand, name: 'Grove' },
      product: { title: 'Grove Cedar tray' },
      words: { headline: 'Cedar tray' }
    }
    const answer = {
      ...good,
      html: `<img src="${photo}" alt=""><p>Grove</p><h1>Cedar tray</h1>`
    }
    expect(designProblems(answer, overlap)).toEqual([])
    expect(sectionAlt(answer, overlap)).toBe('Cedar tray')
    const same = { ...brief, words: { eyebrow: 'NEW!', headline: 'New' } }
    expect(
      designProblems(
        { ...good, html: `<img src="${photo}" alt=""><h1>New</h1>` },
        same
      )
    ).toEqual([])
  })

  it('gives every drawn phrase once in the alt, the headline always, never the brand', () => {
    const asBrand = { ...brief, words: { headline: 'Grove & Co' } }
    expect(
      sectionAlt(
        { ...good, html: `<img src="${photo}" alt=""><h1>Grove &amp; Co</h1>` },
        asBrand
      )
    ).toBe('Grove & Co')
    const asProduct = {
      ...brief,
      words: { headline: 'Cedar tray' },
      product: { title: 'Cedar tray' }
    }
    expect(
      sectionAlt(
        {
          ...good,
          html: `<img src="${photo}" alt=""><h1>Cedar tray</h1><p>Cedar tray</p>`
        },
        asProduct
      )
    ).toBe('Cedar tray')
  })

  it('takes a non-breaking hyphen, and a type on a picture', () => {
    expect(
      designProblems(
        html(
          `<p>Hand\u2011finished, made to last.</p><img src="${photo}" type="image/jpeg" alt="">`
        ),
        brief
      )
    ).toEqual([])
  })

  it('counts the photo as placed only where it is drawn', () => {
    for (const css of [`h1{filter:url("${photo}")}`])
      expect(
        designProblems({ html: '<h1>Meet the cedar tray</h1>', css }, brief)
      ).toContainEqual(
        'Show the product: place the photo given (an <img> or a background).'
      )
    expect(
      designProblems(
        {
          html: `<svg width="600" height="400"><image href="${photo}" width="600" height="400"/></svg><h1>Meet the cedar tray</h1>`,
          css: ''
        },
        brief
      )
    ).toEqual([])
  })

  it('keeps the section format’s own checks', () => {
    expect(
      designProblems(html('<script>alert(1)</script>'), brief)
    ).toContainEqual(expect.stringContaining('<script>'))
    expect(
      designProblems({ ...good, css: '@import url(x.css);' }, brief)
    ).toContainEqual('The section’s styles load or run something.')
  })
})
