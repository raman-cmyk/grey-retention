import { describe, expect, it } from 'vitest'
import type { ButtonPart, ImagePart, RowItem, TextPart } from './blueprint'
import { measured, style } from './fixtures'
import { blueprintFrom, columnsOf, fitRuns, tidyRuns } from './measure'
import { cssColor, fromSnapshot, type DomSnapshot } from './measurement'

/**
 * A made-up classic email as the browser would measure it at 700 px: a
 * centred 600 px table (x 50) with three marked rows: a hero (picture,
 * headline, button), a two-column grid with a filled card, and a footer.
 */
function classicEmail() {
  const m = measured()
  const wrap = m.add(
    m.body,
    'table',
    { x: 0, y: 0, w: 700, h: 760 },
    { display: 'table', background: '#eeeeee' }
  )
  const td = m.add(
    wrap,
    'td',
    { x: 0, y: 0, w: 700, h: 760 },
    { display: 'table-cell' }
  )
  const table = m.add(
    td,
    'table',
    { x: 50, y: 20, w: 600, h: 720 },
    { display: 'table', background: '#ffffff' }
  )
  const tbody = m.add(
    table,
    'tbody',
    { x: 50, y: 20, w: 600, h: 720 },
    { display: 'table-row-group' }
  )
  // Section 1: the hero.
  const r1 = m.add(
    tbody,
    'tr',
    { x: 50, y: 20, w: 600, h: 400 },
    { display: 'table-row' },
    { 'data-gr-section': '1' }
  )
  const c1 = m.add(
    r1,
    'td',
    { x: 50, y: 20, w: 600, h: 400 },
    {
      display: 'table-cell',
      padding: { top: 0, right: 40, bottom: 30, left: 40 }
    }
  )
  const a = m.add(
    c1,
    'a',
    { x: 50, y: 20, w: 600, h: 250 },
    { display: 'inline' },
    { href: 'https://example.com/hero' }
  )
  m.add(
    a,
    'img',
    { x: 50, y: 20, w: 600, h: 250 },
    { display: 'block' },
    { src: 'https://example.com/hero.png', alt: 'Hero' }
  )
  const h = m.add(
    c1,
    'p',
    { x: 90, y: 290, w: 520, h: 40 },
    {
      fontSize: 32,
      fontWeight: 700,
      lineHeight: 40,
      textAlign: 'center',
      color: '#111111'
    }
  )
  m.words(h, 'A new season', [{ x: 250, y: 292, w: 200, h: 36 }])
  const btnTable = m.add(
    c1,
    'table',
    { x: 270, y: 344, w: 160, h: 46 },
    { display: 'table' }
  )
  const btnTd = m.add(
    btnTable,
    'td',
    { x: 270, y: 344, w: 160, h: 46 },
    { display: 'table-cell', background: '#222222', radius: 4 }
  )
  const link = m.add(
    btnTd,
    'a',
    { x: 302, y: 356, w: 96, h: 20 },
    { display: 'inline', color: '#ffffff' },
    { href: 'https://example.com/shop' }
  )
  m.words(link, 'Shop now', [{ x: 302, y: 357, w: 96, h: 18 }], {
    color: '#ffffff',
    fontWeight: 700,
    fontSize: 15,
    lineHeight: 20
  })
  // Section 2: two cards.
  const r2 = m.add(
    tbody,
    'tr',
    { x: 50, y: 420, w: 600, h: 220 },
    { display: 'table-row' },
    { 'data-gr-section': '2' }
  )
  const c2 = m.add(
    r2,
    'td',
    { x: 50, y: 420, w: 600, h: 220 },
    { display: 'table-cell' }
  )
  for (const [i, x] of [80, 360].entries()) {
    const card = m.add(
      c2,
      'div',
      { x, y: 430, w: 260, h: 200 },
      { display: 'inline-block', background: i ? '#f6f6f6' : null }
    )
    m.add(
      card,
      'img',
      { x, y: 430, w: 260, h: 160 },
      { display: 'block' },
      { src: 'https://example.com/p.png', alt: 'Product' }
    )
    const price = m.add(
      card,
      'p',
      { x, y: 600, w: 260, h: 20 },
      { fontSize: 14, lineHeight: 20, textAlign: 'center' }
    )
    m.words(price, '$24.00', [{ x: x + 100, y: 601, w: 50, h: 17 }])
  }
  // Section 3: the footer (a hidden preview line before it is skipped).
  const hidden = m.add(tbody, 'div', null, { display: 'none' })
  m.words(hidden, 'Preview line', [])
  const r3 = m.add(
    tbody,
    'tr',
    { x: 50, y: 660, w: 600, h: 80 },
    { display: 'table-row' },
    { 'data-gr-section': '3' }
  )
  const c3 = m.add(
    r3,
    'td',
    { x: 50, y: 660, w: 600, h: 80 },
    {
      display: 'table-cell',
      background: '#f6f6f6',
      padding: { top: 20, right: 40, bottom: 20, left: 40 },
      textAlign: 'center'
    }
  )
  m.words(c3, 'You signed up. ', [{ x: 200, y: 663, w: 100, h: 14 }], {
    fontSize: 12,
    lineHeight: 18
  })
  const u = m.add(
    c3,
    'a',
    { x: 300, y: 663, w: 80, h: 14 },
    { display: 'inline', underline: true },
    { href: 'https://example.com/unsubscribe' }
  )
  m.words(u, 'Unsubscribe', [{ x: 300, y: 663, w: 80, h: 14 }], {
    fontSize: 12,
    lineHeight: 18
  })
  const br = m.add(
    c3,
    'br',
    { x: 380, y: 663, w: 0, h: 14 },
    { display: 'inline' }
  )
  void br
  m.words(c3, 'Sample Store', [{ x: 260, y: 681, w: 90, h: 14 }], {
    fontSize: 12,
    lineHeight: 18
  })
  return m.done()
}

describe('the measuring tool', () => {
  const result = blueprintFrom(classicEmail())
  if (!result.ok) throw new Error(result.error)
  const bp = result.blueprint

  it('finds the email box, its width, its fills and the page around it', () => {
    expect(bp).toMatchObject({
      width: 600,
      page: '#eeeeee',
      body: '#ffffff',
      margin: { top: 20 }
    })
    expect(bp.sections.map((s) => [s.kind, s.height])).toEqual([
      ['hero', 400],
      ['product_grid', 220],
      ['footer', 80]
    ])
    expect(bp.sections[2]).toMatchObject({
      gapBefore: 20,
      background: '#f6f6f6',
      around: '#ffffff'
    })
  })

  it('measures the hero’s picture, headline and button with their roles', () => {
    const [pic, head, btn] = bp.sections[0]!.items as [
      ImagePart,
      TextPart,
      ButtonPart
    ]
    expect(pic).toMatchObject({
      type: 'image',
      x: 0,
      width: 600,
      height: 250,
      role: 'hero_photo',
      href: 'https://example.com/hero'
    })
    expect(head).toMatchObject({
      type: 'text',
      role: 'headline',
      x: 40,
      width: 520,
      height: 40,
      gapBefore: 20,
      lines: 1,
      align: 'center',
      color: '#111111',
      runs: [{ text: 'A new season' }]
    })
    expect(head.font).toMatchObject({ size: 32, weight: 700, lineHeight: 40 })
    expect(btn).toMatchObject({
      type: 'button',
      role: 'main_button',
      label: 'Shop now',
      href: 'https://example.com/shop',
      x: 220,
      width: 160,
      height: 46,
      background: '#222222',
      radius: 4,
      color: '#ffffff'
    })
    expect(bp.sections[0]!.bottom).toBe(30)
  })

  it('reads cards side by side as a row of columns, a filled one with its fill', () => {
    const row = bp.sections[1]!.items[0] as RowItem
    expect(row.type).toBe('row')
    expect(row.columns.map((c) => [c.x, c.width, c.background])).toEqual([
      [30, 260, null],
      [310, 260, '#f6f6f6']
    ])
    expect(columnsOf(bp.sections[1]!.items)).toHaveLength(2)
    const [photo, price] = row.columns[0]!.items as [ImagePart, TextPart]
    expect(photo.role).toBe('product_photo')
    expect(price).toMatchObject({ role: 'price', gapBefore: 10 })
  })

  it('keeps words, links and line breaks as runs', () => {
    const footer = bp.sections[2]!.items[0] as TextPart
    expect(footer.role).toBe('legal')
    expect(footer.runs).toEqual([
      { text: 'You signed up. ' },
      {
        text: 'Unsubscribe',
        underline: true,
        href: 'https://example.com/unsubscribe'
      },
      { text: '\n' },
      { text: 'Sample Store' }
    ])
    expect(footer.lines).toBe(2)
  })

  it('marks a countdown picture as a section that cannot be copied', () => {
    const m = measured()
    const t = m.add(
      m.body,
      'div',
      { x: 50, y: 0, w: 600, h: 100 },
      {},
      { 'data-gr-section': '1' }
    )
    m.add(
      t,
      'img',
      { x: 50, y: 0, w: 600, h: 100 },
      {},
      { src: 'https://timers.example.com/countdown.gif' }
    )
    const got = blueprintFrom(m.done())
    expect(got.ok && got.blueprint.sections[0]!.unsupported).toBe(
      'a countdown timer or moving picture'
    )
  })

  it('says why an email cannot be measured', () => {
    expect(blueprintFrom(measured().done())).toEqual({
      ok: false,
      error: 'The email has no sections to measure.'
    })
    const m = measured()
    m.add(
      m.body,
      'div',
      { x: 0, y: 0, w: 200, h: 100 },
      { background: '#000000' },
      { 'data-gr-section': '1' }
    )
    expect(blueprintFrom(m.done())).toMatchObject({
      ok: false,
      error: expect.stringMatching(/200 px wide/)
    })
  })
})

describe('measuring odd emails', () => {
  it('marks a drawing or a video inside a line of words as something that cannot be copied', () => {
    const m = measured()
    const sec = m.add(
      m.body,
      'td',
      { x: 50, y: 0, w: 600, h: 60 },
      {},
      { 'data-gr-section': '1' }
    )
    m.words(sec, 'Logo:', [{ x: 50, y: 20, w: 40, h: 18 }])
    m.add(sec, 'svg', { x: 100, y: 10, w: 120, h: 40 }, { display: 'inline' })
    const got = blueprintFrom(m.done())
    expect(got.ok && got.blueprint.sections[0]!.unsupported).toBe(
      'a drawing (SVG)'
    )
  })

  it('drops a link longer than a blueprint keeps instead of refusing the email', () => {
    const m = measured()
    const sec = m.add(
      m.body,
      'td',
      { x: 50, y: 0, w: 600, h: 40 },
      {},
      { 'data-gr-section': '1' }
    )
    const a = m.add(
      sec,
      'a',
      { x: 50, y: 10, w: 80, h: 18 },
      { display: 'inline' },
      { href: `https://example.com/?t=${'x'.repeat(2_100)}` }
    )
    m.words(a, 'Read more', [{ x: 50, y: 10, w: 80, h: 18 }])
    const got = blueprintFrom(m.done())
    if (!got.ok) throw new Error(got.error)
    expect((got.blueprint.sections[0]!.items[0] as TextPart).runs[0]).toEqual({
      text: 'Read more'
    })
  })

  it('keeps at most 12 columns side by side and says the section cannot be copied', () => {
    const m = measured()
    const sec = m.add(
      m.body,
      'td',
      { x: 50, y: 0, w: 600, h: 40 },
      {},
      { 'data-gr-section': '1' }
    )
    for (let i = 0; i < 14; i++)
      m.add(
        sec,
        'img',
        { x: 50 + i * 40, y: 0, w: 30, h: 30 },
        { display: 'block' },
        { src: 'https://example.com/i.png' }
      )
    const got = blueprintFrom(m.done())
    if (!got.ok) throw new Error(got.error)
    expect(
      (got.blueprint.sections[0]!.items[0] as RowItem).columns
    ).toHaveLength(12)
    expect(got.blueprint.sections[0]!.unsupported).toBe(
      'more than 12 columns side by side'
    )
  })

  it('numbers a redraw by its marks, so a section left out keeps the others in place', () => {
    const m = measured()
    for (const [mark, y] of [
      ['1', 0],
      ['3', 100]
    ] as const) {
      const sec = m.add(
        m.body,
        'td',
        { x: 50, y, w: 600, h: 100 },
        {},
        { 'data-gr-section': mark }
      )
      m.words(sec, `Section ${mark}`, [{ x: 50, y: y + 40, w: 80, h: 18 }])
    }
    const byMarks = blueprintFrom(m.done(), { ordinalsFromMarks: true })
    expect(
      byMarks.ok && byMarks.blueprint.sections.map((s) => s.ordinal)
    ).toEqual([1, 3])
    const byPlace = blueprintFrom(m.done())
    expect(
      byPlace.ok && byPlace.blueprint.sections.map((s) => s.ordinal)
    ).toEqual([1, 2])
  })

  it('reads a redraw against its source’s roles', () => {
    const m = measured()
    const sec = m.add(
      m.body,
      'td',
      { x: 50, y: 0, w: 600, h: 100 },
      {},
      { 'data-gr-section': '1' }
    )
    const p = m.add(
      sec,
      'p',
      { x: 50, y: 20, w: 600, h: 30 },
      { fontSize: 24, lineHeight: 30 }
    )
    m.words(p, 'A big line', [{ x: 50, y: 22, w: 200, h: 26 }], {
      fontSize: 24,
      lineHeight: 30
    })
    const alone = blueprintFrom(m.done())
    expect(
      alone.ok && (alone.blueprint.sections[0]!.items[0] as TextPart).role
    ).toBe('headline')
    const against = blueprintFrom(m.done(), {
      roles: { biggestText: 40, mainButton: null, last: 1 }
    })
    expect(
      against.ok && (against.blueprint.sections[0]!.items[0] as TextPart).role
    ).toBe('subheadline')
  })

  it('keeps a very long text within the blueprint’s limits', () => {
    const runs = Array.from({ length: 250 }, (_, i) => ({
      text: `w${i} `,
      weight: i % 2 ? 700 : 400
    }))
    const fitted = fitRuns(runs)
    expect(fitted).toHaveLength(200)
    expect(fitted.at(-1)!.text.startsWith('w199 ')).toBe(true)
    expect(fitRuns([{ text: 'x'.repeat(6_000) }])[0]!.text).toHaveLength(5_000)
  })
})

describe('white space', () => {
  it('collapses blanks as a browser shows them and joins runs with the same look', () => {
    expect(
      tidyRuns([
        { text: ' Hello ' },
        { text: ' world ' },
        { text: '\n' },
        { text: ' next', weight: 700 },
        { text: ' ' }
      ])
    ).toEqual([
      { text: 'Hello world' },
      { text: '\n' },
      { text: 'next', weight: 700 }
    ])
  })
})

describe('the browser snapshot', () => {
  it('reads colours, hiding mostly transparent ones', () => {
    expect(cssColor('rgb(255, 0, 16)')).toBe('#ff0010')
    expect(cssColor('rgba(0, 0, 0, 0)')).toBeNull()
    expect(cssColor('rgba(10, 20, 30, 0.8)')).toBe('#0a141e')
    expect(cssColor('#abc')).toBe('#aabbcc')
    expect(cssColor('transparent')).toBeNull()
  })

  it('turns a DOM snapshot into nodes with boxes, styles, kept attributes and lines', () => {
    const strings = [
      '#document',
      'HTML',
      'BODY',
      'P',
      '#text',
      'Hi',
      'data-gr-section',
      '1',
      'onclick',
      'x',
      'block',
      '16px',
      'rgb(0, 0, 0)'
    ]
    const styles = (display: number) => {
      const out = Array.from({ length: 34 }, () => -1)
      out[0] = display
      out[4] = 11
      out[8] = 12
      return out
    }
    const snap: DomSnapshot = {
      strings,
      documents: [
        {
          nodes: {
            parentIndex: [-1, 0, 1, 2, 3],
            nodeType: [9, 1, 1, 1, 3],
            nodeName: [0, 1, 2, 3, 4],
            nodeValue: [-1, -1, -1, -1, 5],
            attributes: [[], [], [], [6, 7, 8, 9], []]
          },
          layout: {
            nodeIndex: [1, 2, 3, 4],
            styles: [styles(10), styles(10), styles(10), styles(10)],
            bounds: [
              [0, 0, 700, 100],
              [0, 0, 700, 100],
              [10, 10, 600, 20],
              [10, 12, 14, 16]
            ]
          },
          textBoxes: { layoutIndex: [3], bounds: [[10, 12, 14, 16]] },
          contentHeight: 100
        }
      ]
    }
    const m = fromSnapshot(snap, 700)
    expect(m.nodes[0]!.tag).toBe('#other')
    expect(m.nodes[3]).toMatchObject({
      tag: 'p',
      attrs: { 'data-gr-section': '1' },
      box: { x: 10, y: 10, w: 600, h: 20 }
    })
    expect(m.nodes[3]!.attrs).not.toHaveProperty('onclick')
    expect(m.nodes[3]!.style).toMatchObject({
      display: 'block',
      fontSize: 16,
      color: '#000000',
      lineHeight: null
    })
    expect(m.nodes[4]).toMatchObject({
      tag: '#text',
      text: 'Hi',
      lines: [{ x: 10, y: 12, w: 14, h: 16 }]
    })
    expect(m.contentHeight).toBe(100)
    expect(() => fromSnapshot({ strings: [], documents: [] }, 700)).toThrow()
    expect(style().display).toBe('block')
  })
})
