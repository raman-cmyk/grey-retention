/**
 * The brand a block is drawn in (BLK-001): the brand kit's logo, 3 colours
 * and font (VISION.md section 5). Everything here is checked before it
 * reaches HTML or CSS: colours must be hex, font names may only hold
 * letters, digits, spaces and hyphens, so nothing from a scraped kit can
 * break out of a style attribute.
 */
export type BlockBrand = {
  name: string
  logo?: { url: string; alt?: string }
  colors: {
    /** Buttons, headlines and the offer banner. */
    primary: string
    /** Small accents: stars, numbers, thin bars. */
    accent: string
    /** The email's page colour. */
    background: string
  }
  /** The brand font's family name, e.g. "Playfair Display". */
  font: string
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** A hex colour, or the fallback when the kit gave something else. */
export function safeColor(value: string | undefined, fallback: string) {
  const v = value?.trim() ?? ''
  if (!HEX.test(v)) return fallback
  return v.length === 4
    ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase()
    : v.toLowerCase()
}

function luminance(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** WCAG contrast ratio of two hex colours. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Near-black or white, whichever reads better on the colour. */
export function inkOn(color: string) {
  const dark = '#1a1a1a'
  return contrast(color, dark) >= contrast(color, '#ffffff') ? dark : '#ffffff'
}

/**
 * A brand colour used as text on the page colour, or the readable ink when
 * it is too faint (below 3:1, the WCAG floor for large text).
 */
export function readableOn(color: string, background: string) {
  return contrast(color, background) >= 3 ? color : inkOn(background)
}

/** Fonts every email client already has. */
const webSafe = new Map([
  ['arial', 'sans'],
  ['helvetica', 'sans'],
  ['verdana', 'sans'],
  ['tahoma', 'sans'],
  ['trebuchet ms', 'sans'],
  ['georgia', 'serif'],
  ['times new roman', 'serif'],
  ['times', 'serif'],
  ['courier new', 'mono']
])
const serifHints =
  /serif|playfair|lora|merriweather|garamond|baskerville|caslon|bodoni|didot|cormorant|crimson|libre|fraunces|spectral|prata|cardo|domine/i
const stacks = {
  sans: 'Helvetica, Arial, sans-serif',
  serif: "Georgia, 'Times New Roman', Times, serif",
  mono: "'Courier New', Courier, monospace"
} as const

/**
 * The brand font first, then a web-safe stack of the same kind, so a
 * client without the font (most of them) still shows the right feel.
 */
export function fontStack(font: string | undefined) {
  const name = (font ?? '')
    .replace(/[^A-Za-z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  if (!name) return stacks.sans
  const known = webSafe.get(name.toLowerCase())
  const kind =
    known ??
    (/sans/i.test(name) ? 'sans' : serifHints.test(name) ? 'serif' : 'sans')
  const stack = stacks[kind as keyof typeof stacks]
  return known ? stack : `'${name}', ${stack}`
}

/**
 * The renderer's view of a brand kit row: up to 3 colours in kit order
 * (primary, accent, page colour) and the first font.
 */
export function brandFromKit(input: {
  name: string
  colors: readonly string[]
  fonts: readonly string[]
  logo?: { url: string; alt?: string }
}): BlockBrand {
  const primary = safeColor(input.colors[0], '#1a1a1a')
  return {
    name: input.name.trim() || 'Your brand',
    logo: input.logo,
    colors: {
      primary,
      accent: safeColor(input.colors[1], primary),
      background: safeColor(input.colors[2], '#ffffff')
    },
    font: input.fonts[0] ?? ''
  }
}
