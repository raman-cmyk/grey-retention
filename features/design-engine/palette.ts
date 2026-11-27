import { contrast, inkOn, readableOn } from '@/features/blocks/brand'

/**
 * DES-ENGINE-002, the brand swap's colours: every colour of a library
 * email (its page, body, section and card fills, words, buttons, borders
 * and lines) mapped to a role of the brand's own palette, with readable
 * contrast. Code only, the same email and brand always give the same
 * colours:
 * - fills: near-white stays white; another light neutral becomes the
 *   brand's light background; a light colour becomes a pale tint of the
 *   brand's accent; a dark one the brand's dark colour; any other colour
 *   the accent;
 * - words: dark words become the brand's ink, grey words a softer ink,
 *   light words white, coloured words the accent; each is checked against
 *   the fill behind it (4.5:1, or 3:1 for big headings) and made black or
 *   white where it would be hard to read;
 * - buttons: a coloured or dark button becomes the accent (a light one on
 *   a dark band stays light), its label black or white, whichever reads.
 */

export type BrandPalette = {
  /** Words. */
  ink: string
  /** Around the email. */
  background: string
  /** Buttons and highlights. */
  accent: string
  /** Dark bands. */
  dark: string
}

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number
  ]

/** Relative luminance, 0 (black) to 1 (white). */
export function lightness(hex: string) {
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  const [r, g, b] = channels(hex).map(lin) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** How colourful a colour is: the spread of its channels, 0 to 1. */
export function colourfulness(hex: string) {
  const c = channels(hex)
  return Math.max(...c) - Math.min(...c)
}

const toHex = (c: number[]) =>
  `#${c
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`

/** `a` mixed with `b`: `share` of `b` (0 keeps `a`). */
export function mix(a: string, b: string, share: number) {
  const x = channels(a)
  const y = channels(b)
  return toHex(x.map((v, i) => v + (y[i]! - v) * share))
}

const white = '#ffffff'

export function paletteMapper(brand: BrandPalette) {
  const lightBackground =
    lightness(brand.background) > 0.8 ? brand.background : '#f6f6f6'
  const fills = new Map<string, string>()
  /** A fill (page, body, section, card, button face). */
  const fill = (source: string): string => {
    const known = fills.get(source)
    if (known) return known
    const l = lightness(source)
    const c = colourfulness(source)
    const out =
      l > 0.97 && c < 0.04
        ? white
        : l > 0.55 && c < 0.08
          ? lightBackground
          : l > 0.55
            ? mix(brand.accent, white, 0.88)
            : l < 0.05 || (l < 0.16 && c < 0.25)
              ? brand.dark
              : brand.accent
    fills.set(source, out)
    return out
  }
  /** Words of `size` px in `source` colour on the (already mapped) fill. */
  const text = (source: string, behind: string, size: number): string => {
    const min = size >= 24 ? 3 : 4.5
    const l = lightness(source)
    const c = colourfulness(source)
    const wanted =
      c > 0.3 && l > 0.03 && l < 0.7
        ? brand.accent
        : l > 0.5
          ? white
          : l < 0.06
            ? brand.ink
            : mix(brand.ink, behind, 0.3)
    return readableOn(wanted, behind, min)
  }
  /** A button's face on the fill behind it. */
  const button = (source: string, behind: string): string => {
    const face = lightness(source) > 0.6 ? white : brand.accent
    // A face that disappears into its band is drawn in the band's ink.
    return contrast(face, behind) < 1.4 ? inkOn(behind) : face
  }
  /** A line or a border. */
  const line = (source: string, behind: string): string =>
    colourfulness(source) > 0.3 ? brand.accent : mix(brand.ink, behind, 0.82)
  /** A fill kept apart from the fill behind it when the original's was. */
  const apart = (mapped: string, behind: string) =>
    mapped !== behind
      ? mapped
      : lightness(mapped) > 0.5
        ? mix(mapped, brand.ink, 0.05)
        : mix(mapped, white, 0.1)
  return {
    fill,
    apart,
    text,
    button,
    line,
    label: (face: string) => inkOn(face),
    page: lightness(brand.background) > 0.5 ? brand.background : white
  }
}
export type PaletteMapper = ReturnType<typeof paletteMapper>

/**
 * DES-ENGINE-003b: an own design's text colour, kept, or moved only as far
 * towards near-black or white (whichever reads on `behind`) as it takes to
 * be readable (`min`, 4.5 to 1, or 3 for large words): the hue stays.
 */
export function nudged(color: string, behind: string, min: number): string {
  if (contrast(color, behind) >= min) return color
  const ink = inkOn(behind)
  for (let share = 0.1; share < 1; share += 0.1) {
    const next = mix(color, ink, share)
    if (contrast(next, behind) >= min) return next
  }
  return ink
}

/** The contrast a text of `size` px needs (as the email's checks read it). */
export const neededContrast = (size: number) => (size >= 24 ? 3 : 4.5)
export { contrast }
