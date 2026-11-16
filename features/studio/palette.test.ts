// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { coloursUsed, paletteProblems, parseColour } from './palette'

/** DST-PIC #13: a designed section stays on the brand's palette. */
const terracotta = ['#1f2a24', '#f6f1e8', '#b5532e', '#22301f']
const rgb = (r: number, g: number, b: number, clear = false) => ({
  rgb: [r, g, b],
  clear
})
/** The colours of `css` that are off `palette` (empty: all on it). */
const offOf = (css: string, palette: readonly string[]) =>
  paletteProblems({ css, html: '' }, palette)
/** `colours` as text colours, one rule each. */
const using = (colours: string[]) =>
  colours.map((c, i) => `.c${i}{color:${c}}`).join('')

describe('the brand’s palette in a designed section (DST-PIC #13)', () => {
  it('reads colours as the browser does', () => {
    expect(parseColour('#B5532E')).toEqual(rgb(181, 83, 46))
    expect(parseColour('#fff')).toEqual(rgb(255, 255, 255))
    expect(parseColour('#b5532e80')).toEqual(rgb(181, 83, 46))
    expect(parseColour('rgb(181, 83, 46)')).toEqual(rgb(181, 83, 46))
    expect(parseColour('rgb(71% 33% 18%)')).toEqual(rgb(181, 84, 46))
    expect(parseColour('rgba(181 83 46 / 50%)')).toEqual(rgb(181, 83, 46))
    expect(parseColour('hsl(16, 59%, 45%)')).toEqual(rgb(182, 83, 47))
    // The newer syntax: plain numbers are percentages; hue units; none.
    expect(parseColour('hsl(200 80 50)')).toEqual(
      parseColour('hsl(200deg 80% 50%)')
    )
    expect(parseColour('hsl(0.6turn 90% 50%)')).toEqual(
      parseColour('hsl(216 90% 50%)')
    )
    expect(parseColour('hsl(3.14159265rad 50% 50%)')).toEqual(
      parseColour('hsl(180 50% 50%)')
    )
    expect(parseColour('hsl(none 100% 50%)')).toEqual(rgb(255, 0, 0))
    // Nothing painted: no colour, or a fully clear one.
    for (const none of ['transparent', 'currentColor', 'inherit', 'none'])
      expect(parseColour(none)).toBeNull()
    expect(parseColour('rgba(255,0,0,0)')).toEqual(rgb(255, 0, 0, true))
    expect(parseColour('#ff000000')).toEqual(rgb(255, 0, 0, true))
    expect(parseColour('white')).toEqual(rgb(255, 255, 255))
    for (const named of ['tomato', 'LinkText', 'AccentColor'])
      expect(parseColour(named), named).toBe('named')
    // What it cannot read for sure.
    for (const unread of [
      'oklch(0.6 0.15 30)',
      'lab(50% 40 30)',
      'hwb(200 10% 10%)',
      'color-mix(in srgb, red, blue)',
      'rgb(calc(0) 87 255)',
      'rgb(from #b5532e r g 255)',
      '#12345'
    ])
      expect(parseColour(unread), unread).toBe('unread')
  })

  it('finds the colours in styles, inline styles and SVG paint, never in font names or links', () => {
    expect(
      coloursUsed({
        css: '.a{color:#b5532e;background:linear-gradient(#fff,rgba(0,0,0,.4))}h1{font-family:"Gold Serif",serif}.u{background:url(#abc)}',
        html: '<p style="border:1px solid #1f2a24;font-family:Cedar">x</p><svg viewBox="0 0 1 1"><rect fill="url(#abc)" stroke="hsl(16,59%,45%)" font-family="Gold"/><circle fill="oklch(0.6 0.1 30)"/></svg>'
      })
    ).toEqual([
      '#b5532e',
      '#fff',
      'rgba(0,0,0,.4)',
      '#1f2a24',
      'hsl(16,59%,45%)',
      'oklch(0.6 0.1 30)'
    ])
  })

  it('takes the brand’s colours, their lighter and darker shades and neutrals', () => {
    // Terracotta: the accent, a tint and a shade of it, greys, white, a
    // shadow, and a red so clear it paints nothing.
    expect(
      offOf(
        '.a{color:#b5532e;background:#f3d9cf;border-color:#5a2917}.b{color:#777;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.2)}.c{color:rgba(255,0,0,0)}',
        terracotta
      )
    ).toEqual([])
    // Navy: the ink mixed with white, and the usual navies.
    expect(
      offOf(using(['#23354e', '#3c4c61', '#546275', '#2c3e50', '#34495e']), [
        '#0b1f3a',
        '#ffffff',
        '#c9a227'
      ])
    ).toEqual([])
    // Black and white: the usual greys, slate-tinted ones too.
    expect(
      offOf(
        using([
          '#111827',
          '#1f2937',
          '#374151',
          '#e5e7eb',
          '#f3f4f6',
          '#0f172a',
          '#1e293b'
        ]),
        ['#111111', '#ffffff']
      )
    ).toEqual([])
    // Pastel: the accent's darker shades, the background's.
    expect(
      offOf(using(['#c38593', '#7a535c', '#312125', '#e6dfdb']), [
        '#2b2b2b',
        '#fff8f3',
        '#f4a6b8'
      ])
    ).toEqual([])
  })

  it('names an off-palette colour back with the brand’s colours, a colour by name, and what it cannot read', () => {
    const own = '(#1f2a24, #f6f1e8, #b5532e, #22301f)'
    expect(offOf('.a{color:#0057ff;background:#00c853}', terracotta)).toEqual([
      `The section uses #0057ff, #00c853, off the brand’s palette: use the brand’s colours ${own}, a lighter or darker shade of one, or a neutral.`
    ])
    expect(
      offOf(
        using(['#0057ff', '#00c853', '#7c3aed', '#facc15', '#ec4899']),
        terracotta
      )
    ).toEqual([
      `The section uses #0057ff, #00c853, #7c3aed and 2 more, off the brand’s palette: use the brand’s colours ${own}, a lighter or darker shade of one, or a neutral.`
    ])
    // A cream background and a slate ink have no colour to shade.
    expect(
      offOf(using(['#d9a441', '#3b6ea5']), ['#1f2933', '#f6f1e8'])
    ).toEqual([
      'The section uses #d9a441, #3b6ea5, off the brand’s palette: use the brand’s colours (#1f2933, #f6f1e8), a lighter or darker shade of one, or a neutral.'
    ])
    expect(offOf('.a{color:tomato}', terracotta)).toEqual([
      'Name colours by their hex (or white and black), from the brand’s palette.'
    ])
    expect(offOf('.a{color:oklch(0.6 0.15 30)}', terracotta)).toEqual([
      'Write each colour as a hex (or rgb, hsl): “oklch(0.6 0.15 30)” cannot be read for sure.'
    ])
  })
})
