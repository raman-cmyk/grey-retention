// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { coloursUsed, paletteProblems, parseColour } from './palette'

/** DST-PIC #13: a designed section stays on the brand's palette. */
const brand = ['#1f2a24', '#f6f1e8', '#b5532e', '#22301f']
const off = (list: string) =>
  `The section uses ${list}, off the brand’s palette: use the brand’s colours (#1f2a24, #f6f1e8, #b5532e, #22301f), a lighter or darker shade of one, or a neutral.`

describe('the brand’s palette in a designed section (DST-PIC #13)', () => {
  it('reads colours as the browser does', () => {
    expect(parseColour('#B5532E')).toEqual([181, 83, 46])
    expect(parseColour('#fff')).toEqual([255, 255, 255])
    expect(parseColour('#b5532e80')).toEqual([181, 83, 46])
    expect(parseColour('rgb(181, 83, 46)')).toEqual([181, 83, 46])
    expect(parseColour('rgba(181 83 46 / 50%)')).toEqual([181, 83, 46])
    expect(parseColour('hsl(16, 59%, 45%)')).toEqual([182, 83, 47])
    for (const none of ['transparent', 'currentColor', 'inherit', 'none'])
      expect(parseColour(none)).toBeNull()
    expect(parseColour('white')).toEqual([255, 255, 255])
    expect(parseColour('tomato')).toBe('named')
  })

  it('finds the colours in styles, inline styles and SVG paint, never in font names or links', () => {
    expect(
      coloursUsed({
        css: '.a{color:#b5532e;background:linear-gradient(#fff,rgba(0,0,0,.4))}h1{font-family:"Gold Serif",serif}',
        html: '<p style="border:1px solid #1f2a24">x</p><svg viewBox="0 0 1 1"><rect fill="url(#abc)" stroke="hsl(16,59%,45%)"/></svg>'
      })
    ).toEqual([
      '#b5532e',
      '#fff',
      'rgba(0,0,0,.4)',
      '#1f2a24',
      'hsl(16,59%,45%)'
    ])
  })

  it('takes the brand’s colours, their lighter and darker shades and neutrals', () => {
    expect(
      paletteProblems(
        {
          // The accent, a light tint and a dark shade of it, greys, white.
          css: '.a{color:#b5532e;background:#f3d9cf;border-color:#5a2917}.b{color:#777;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.2)}',
          html: '<svg viewBox="0 0 1 1"><rect fill="#22301f"/></svg>'
        },
        brand
      )
    ).toEqual([])
  })

  it('names an off-palette colour back with the brand’s colours, and a colour by name', () => {
    expect(
      paletteProblems(
        { css: '.a{color:#0057ff;background:#00c853}', html: '<p>x</p>' },
        brand
      )
    ).toEqual([off('#0057ff, #00c853')])
    expect(
      paletteProblems({ css: '.a{color:tomato}', html: '<p>x</p>' }, brand)
    ).toEqual([
      'Name colours by their hex (or white and black), from the brand’s palette.'
    ])
    // A brand with no colour of its own (greys only): any colour is off it.
    expect(
      paletteProblems({ css: '.a{color:#b5532e}', html: '' }, [
        '#222222',
        undefined
      ])
    ).toEqual([
      'The section uses #b5532e, off the brand’s palette: use the brand’s colours (#222222), a lighter or darker shade of one, or a neutral.'
    ])
  })
})
