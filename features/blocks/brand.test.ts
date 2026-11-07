import { describe, expect, it } from 'vitest'
import {
  brandFromKit,
  contrast,
  fontStack,
  inkOn,
  readableOn,
  safeColor,
  safeRadius
} from './brand'

describe('brand colours', () => {
  it('accepts hex only and expands short hex', () => {
    expect(safeColor('#ABC', '#000000')).toBe('#aabbcc')
    for (const bad of [
      'red',
      'rgb(0,0,0)',
      '#12345',
      '',
      undefined,
      '#fff;background:url(x)'
    ])
      expect(safeColor(bad, '#000000')).toBe('#000000')
  })

  it('picks readable text, stricter for small text', () => {
    expect(inkOn('#ffffff')).toBe('#1a1a1a')
    expect(inkOn('#2f4a3a')).toBe('#ffffff')
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    // #c9a96e on white is about 2.2:1: too faint for any text.
    expect(readableOn('#c9a96e', '#ffffff')).toBe('#1a1a1a')
    // #b23f79 is about 5.6:1 on white: fine for small text.
    expect(readableOn('#b23f79', '#ffffff')).toBe('#b23f79')
    // #d06a9a is about 3.4:1: fine for a big heading, not for small text.
    expect(readableOn('#d06a9a', '#ffffff', 3)).toBe('#d06a9a')
    expect(readableOn('#d06a9a', '#ffffff')).toBe('#1a1a1a')
  })

  it('keeps the corner radius small and in pixels', () => {
    expect(safeRadius('8px')).toBe('8px')
    expect(safeRadius('0px')).toBe('0px')
    for (const bad of ['50%', '99px', '8px;color:red', undefined])
      expect(safeRadius(bad)).toBe('8px')
  })
})

describe('fontStack (web-safe fallback)', () => {
  it('puts the brand font first, then a stack of the same kind', () => {
    expect(fontStack('Poppins')).toBe("'Poppins', Arial, Helvetica, sans-serif")
    expect(fontStack('Playfair Display')).toBe(
      "'Playfair Display', Georgia, 'Times New Roman', Times, serif"
    )
    expect(fontStack('Roboto Slab')).toBe(
      "'Roboto Slab', Georgia, 'Times New Roman', Times, serif"
    )
    expect(fontStack('Libre Franklin')).toBe(
      "'Libre Franklin', Arial, Helvetica, sans-serif"
    )
  })

  it('uses a web-safe font as it is, and strips anything that breaks CSS', () => {
    expect(fontStack('Georgia')).toBe(
      "Georgia, 'Times New Roman', Times, serif"
    )
    expect(fontStack(undefined)).toBe('Arial, Helvetica, sans-serif')
    expect(fontStack("Evil'; } body { display:none")).toBe(
      "'Evil body displaynone', Arial, Helvetica, sans-serif"
    )
    expect(fontStack('<>{};')).toBe('Arial, Helvetica, sans-serif')
  })
})

describe('brandFromKit (roles from an unordered scraped list)', () => {
  it('finds background, ink, accent and dark by colour, not position', () => {
    expect(
      brandFromKit({
        name: ' Example Co ',
        site: 'https://example.com',
        colors: ['#B23F79', '#FAFAFA', '#121212', '#6E1E2D'],
        fonts: ['Poppins', 'Inter']
      })
    ).toEqual({
      name: 'Example Co',
      site: 'https://example.com',
      logo: undefined,
      font: 'Poppins',
      ink: '#121212',
      background: '#fafafa',
      accent: '#b23f79',
      dark: '#6e1e2d'
    })
  })

  it('falls back calmly when the kit is thin', () => {
    expect(
      brandFromKit({ name: '', colors: ['nope'], fonts: [] })
    ).toMatchObject({
      name: 'Your brand',
      ink: '#121212',
      background: '#fafafa',
      accent: '#121212',
      dark: '#121212'
    })
  })
})
