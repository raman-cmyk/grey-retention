import { describe, expect, it } from 'vitest'
import { fontCategory, safeFontStack } from './fonts'
import { cleanFamily } from './measure'

describe('safe font stacks', () => {
  it('keeps a list that already ends in a generic family exactly', () => {
    expect(safeFontStack('Helvetica Neue, Helvetica, Arial, sans-serif')).toBe(
      "'Helvetica Neue', Helvetica, Arial, sans-serif"
    )
  })

  it('adds the closest safe fonts the list does not name yet', () => {
    expect(safeFontStack('Arial')).toBe('Arial, Helvetica, sans-serif')
    expect(safeFontStack('Playfair Display')).toBe(
      "'Playfair Display', Georgia, 'Times New Roman', Times, serif"
    )
    expect(safeFontStack('Space Mono')).toBe(
      "'Space Mono', 'Courier New', Courier, monospace"
    )
    expect(safeFontStack('')).toBe('Helvetica, Arial, sans-serif')
  })

  it('reads the category from the first font', () => {
    expect(fontCategory("'Source Serif Pro', Arial")).toBe('serif')
    expect(fontCategory("'Open Sans', serif")).toBe('sans')
    expect(fontCategory("'PT Sans Serif'")).toBe('sans')
  })

  it('cleans a computed family list to names only', () => {
    expect(cleanFamily('"Brand Font", Arial;color:red, sans-serif')).toBe(
      'Brand Font, Arialcolorred, sans-serif'
    )
    expect(cleanFamily('Georgia, "Times New Roman", serif')).toBe(
      'Georgia, Times New Roman, serif'
    )
    // Anything but a name never reaches the email's CSS.
    expect(safeFontStack("Arial'; } body { color:red")).toBe(
      'Helvetica, Arial, sans-serif'
    )
  })
})
