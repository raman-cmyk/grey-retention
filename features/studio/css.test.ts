// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readCss } from './css'
import {
  sectionDocument,
  sectionProblems,
  sectionUrls,
  type DesignedSection
} from './section'

const photo = 'https://cdn.shop.example/images/tray.jpg'

describe('reading a section’s styles (DST-003a)', () => {
  it('reads rules, nested rules and declarations, and their links', () => {
    const read = readCss(
      `.panel{position:absolute;inset:0;background:url("${photo}") center/cover,linear-gradient(160deg,#1f2933,#111827);.tray{width:calc(100% - 20px)}}h1{font:600 56px "Grove Serif",Arial,sans-serif !important;font-variation-settings:"wght" 650}h1::before{content:""}.b{background-image:url( ${photo} )}`
    )
    expect(read.problems).toEqual([])
    expect(read.unread).toBe(false)
    expect(read.urls).toEqual([photo, photo])
    expect(read.declarations.map((d) => d.property)).toEqual([
      'position',
      'inset',
      'background',
      'width',
      'font',
      'font-variation-settings',
      'content',
      'background-image'
    ])
    expect(read.declarations[4].value).toBe(
      '600 56px "Grove Serif",Arial,sans-serif'
    )
  })

  it('reads an inline style as its declarations only', () => {
    expect(readCss('color:#fff; top:10px', true).declarations).toEqual([
      { property: 'color', value: '#fff' },
      { property: 'top', value: '10px' }
    ])
    expect(readCss('color:red}h1::after{content:"x"', true)).toMatchObject({
      unread: true,
      problems: ['An inline style has a block in it.']
    })
  })

  it.each([
    // After a nested rule, a declaration is still a declaration.
    ['h1::after{x{}content:" 20% OFF"}', /content/],
    // A `url(` inside a string is part of the string.
    ['h2{font-family:"url("}h1::after{content:" CODE SAVE20"}', /content/],
    ['li{list-style-type:attr(aria-label)}', /list-style-type/],
    ['h1{color:attr(title)}', /attr\(\)/],
    ['ul{list-style:decimal}', /list-style/],
    ['p{counter-set:list-item 2025}', /counter-set/],
    ['p{display:list-item}', /display: list-item/],
    ['p{display:none}', /display: none/],
    ['p{visibility:hidden}', /visibility/],
    ['p{text-overflow:ellipsis}', /text-overflow/],
    ['h1{text-emphasis-style:"$"}', /text-emphasis-style/],
    ['p{hyphenate-character:"off"}', /hyphenate-character/],
    ['p{unicode-bidi:bidi-override;direction:rtl}', /unicode-bidi/],
    [':root{--w:"SALE"}', /--w/],
    ['h1{color:var(--w)}', /var\(\)/],
    ['.g{grid-template-areas:"a b"}', /grid-template-areas/],
    ['h1{font-family:"Grove";color:"red"}', /color style has words/],
    ['p{-webkit-text-fill-color:transparent}', /-webkit-text-fill-color/],
    ['p{background:image-set("a.png" 1x)}', /image-set\(\)/],
    ['p{color:red;oops}', /oops/]
  ])('refuses what can draw words or hide them: %s', (css, problem) => {
    const read = readCss(css)
    expect(read.problems.join(' ')).toMatch(problem)
  })

  it.each([
    ['h1{/*x*/content:"20% off"}', 'Leave comments out of the styles.'],
    ['@media (min-width:1px){h1{color:red}}', /at-rule/],
    ['h1{font-family:"Gr\\6f ve"}', /escape/],
    [
      'h1{font-family:"Grove}',
      'The styles have a string that is never closed.'
    ],
    ['h1{color:rgb(1,2,3}', 'The styles open a bracket they never close.'],
    ['h1{color:red', 'The styles open a block they never close.'],
    ['h1{color:red}}', 'The styles close a block they never opened.'],
    ['p{background:url(a b)}', 'A link in the styles is not one link.'],
    ['p{background:url("a" x)}', 'A link in the styles is never closed.'],
    ['h1{color:red}stray', 'The styles end with something that is not a rule.']
  ])('refuses what it cannot read for sure: %s', (css, problem) => {
    const read = readCss(css)
    expect(read.problems).toContainEqual(
      typeof problem === 'string' ? problem : expect.stringMatching(problem)
    )
  })
})

describe('the section format reads links with it (DST-001a, DST-003a)', () => {
  const section = (css: string): DesignedSection => ({
    id: 's2',
    height: 400,
    html: `<img src="${photo}" alt="">`,
    css
  })

  it('finds a link after a string that looks like one', () => {
    const css =
      'h2{font-family:"url(https://cdn.shop.example/a"}h1{background:url(https://evil.example/x.png)}'
    expect(sectionProblems(section(css), ['cdn.shop.example'])).toContainEqual(
      expect.stringContaining('https://evil.example/x.png')
    )
    expect(sectionUrls(section(css), ['cdn.shop.example'])).toContain(
      'https://evil.example/x.png'
    )
  })

  it.each([
    ['h1::before{content:"20% OFF"}', /content/],
    ['p::before{content:attr(title)}', /content/],
    ['ol{counter-reset:n}li::before{content:counter(n) ". "}', /counter-reset/],
    ['p{display:block list-item}', /display: block list-item/],
    ['p{-webkit-text-fill-color:red}', /-webkit-text-fill-color/],
    ['ul{list-style:decimal inside}', /list-style: decimal inside/]
  ])('refuses styles that draw words: %s', (css, problem) => {
    expect(
      sectionProblems(section(css), ['cdn.shop.example']).join(' ')
    ).toMatch(problem)
  })

  it.each([
    ['display:block list-item', /display: block list-item/],
    ['-webkit-text-fill-color:red', /-webkit-text-fill-color/],
    ['list-style:decimal inside', /list-style: decimal inside/]
  ])('refuses them in an inline style too: %s', (style, problem) => {
    const inline: DesignedSection = {
      ...section(''),
      html: `<img src="${photo}" alt=""><p style="${style}">Hi</p>`
    }
    expect(sectionProblems(inline, ['cdn.shop.example']).join(' ')).toMatch(
      problem
    )
  })

  it('takes a retina picture name, tables, no list markers and SVG gradients', () => {
    const hosts = ['cdn.shop.example']
    expect(
      sectionProblems(
        {
          ...section(
            'p{background-image:url("https://cdn.shop.example/hero@2x.jpg")}.t{display:table-cell}ul{list-style:none}'
          ),
          html: `<img src="${photo}" alt=""><svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>`
        },
        hosts
      )
    ).toEqual([])
    expect(readCss('p{color:red}@media x{}').problems).toEqual([
      'The styles use an at-rule, which a picture never needs.'
    ])
  })

  it('the page it draws turns list markers off', () => {
    expect(sectionDocument(section(''))).toContain('li{list-style:none}')
  })

  it('refuses styles it cannot read for sure', () => {
    expect(
      sectionProblems(section('h1{/* url(x) */color:red}'), [
        'cdn.shop.example'
      ])
    ).toContainEqual('Leave comments out of the styles.')
  })
})
