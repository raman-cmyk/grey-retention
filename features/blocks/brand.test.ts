import { describe, expect, it } from 'vitest'
import {
  brandFromKit,
  contrast,
  fontStack,
  inkOn,
  readableOn,
  safeColor
} from './brand'

describe('brand colours', () => {
  it('accepts hex only and expands short hex', () => {
    expect(safeColor('#ABC', '#000000')).toBe('#aabbcc')
    expect(safeColor(' #12a4F0 ', '#000000')).toBe('#12a4f0')
    for (const bad of [
      'red',
      'rgb(0,0,0)',
      '#12345',
      '#1234567',
      '',
      undefined
    ])
      expect(safeColor(bad, '#000000')).toBe('#000000')
    // Nothing from a scraped kit can break out of a style attribute.
    expect(safeColor('#fff;background:url(x)', '#000000')).toBe('#000000')
  })

  it('picks readable text for a colour', () => {
    expect(inkOn('#ffffff')).toBe('#1a1a1a')
    expect(inkOn('#2f4a3a')).toBe('#ffffff')
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    // A pale brand colour is too faint for headlines on white.
    expect(readableOn('#f6e7a1', '#ffffff')).toBe('#1a1a1a')
    expect(readableOn('#2f4a3a', '#ffffff')).toBe('#2f4a3a')
  })
})

describe('fontStack (web-safe fallback)', () => {
  it('puts the brand font first, then a stack of the same kind', () => {
    expect(fontStack('Playfair Display')).toBe(
      "'Playfair Display', Georgia, 'Times New Roman', Times, serif"
    )
    expect(fontStack('Inter')).toBe("'Inter', Helvetica, Arial, sans-serif")
    expect(fontStack('Source Sans 3')).toBe(
      "'Source Sans 3', Helvetica, Arial, sans-serif"
    )
  })

  it('uses a web-safe font as it is', () => {
    expect(fontStack('Georgia')).toBe(
      "Georgia, 'Times New Roman', Times, serif"
    )
    expect(fontStack('arial')).toBe('Helvetica, Arial, sans-serif')
    expect(fontStack(undefined)).toBe('Helvetica, Arial, sans-serif')
  })

  it('strips anything that could break the CSS', () => {
    expect(fontStack("Evil'; } body { display:none")).toBe(
      "'Evil body displaynone', Helvetica, Arial, sans-serif"
    )
    expect(fontStack('<>{};')).toBe('Helvetica, Arial, sans-serif')
  })
})

describe('brandFromKit', () => {
  it('reads up to 3 colours in kit order and the first font', () => {
    expect(
      brandFromKit({
        name: ' Cedar Lane ',
        colors: ['#2f4a3a', '#c9a96e', '#fbf8f2', '#000000'],
        fonts: ['Playfair Display', 'Inter']
      })
    ).toEqual({
      name: 'Cedar Lane',
      logo: undefined,
      colors: { primary: '#2f4a3a', accent: '#c9a96e', background: '#fbf8f2' },
      font: 'Playfair Display'
    })
  })

  it('falls back calmly when the kit is incomplete', () => {
    expect(brandFromKit({ name: '', colors: ['#123456'], fonts: [] })).toEqual({
      name: 'Your brand',
      logo: undefined,
      colors: { primary: '#123456', accent: '#123456', background: '#ffffff' },
      font: ''
    })
    expect(
      brandFromKit({ name: 'X', colors: ['nope'], fonts: [] }).colors.primary
    ).toBe('#1a1a1a')
  })
})
