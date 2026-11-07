/**
 * The brand a block is drawn in (BLK-001), with the colour roles of the
 * Step 0 reference kit (docs/step0/example_spec.json): `ink` for text,
 * `background` around the email, `accent` for buttons and highlights,
 * `dark` for the announcement bar. Everything is checked before it reaches
 * HTML or CSS: colours must be hex, font names may only hold letters,
 * digits, spaces and hyphens, the radius is a small pixel value.
 */
export type BlockBrand = {
  name: string
  /** The store link behind the logo. */
  site: string
  /** The logo picture (https; Klaviyo-hosted when sent). */
  logo?: string
  /** The brand font's family name, e.g. "Poppins". */
  font: string
  ink: string
  background: string
  accent: string
  dark: string
  /** Corner radius for buttons and photos, e.g. "8px". */
  radius?: string
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

/** "8px"-style radius between 0 and 24px, else 8px. */
export function safeRadius(value: string | undefined) {
  const m = /^(\d{1,2})px$/.exec(value?.trim() ?? '')
  return m && Number(m[1]) <= 24 ? `${Number(m[1])}px` : '8px'
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

const nearBlack = '#1a1a1a'

/** Near-black or white, whichever reads better on the colour. */
export function inkOn(color: string) {
  return contrast(color, nearBlack) >= contrast(color, '#ffffff')
    ? nearBlack
    : '#ffffff'
}

/**
 * A colour used as text on a background, or the readable ink when it is
 * too faint. `min` is 4.5 for normal text and 3 for large headings (WCAG).
 */
export function readableOn(color: string, background: string, min = 4.5) {
  return contrast(color, background) >= min ? color : inkOn(background)
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
  /serif|slab|playfair|lora|merriweather|garamond|baskerville|caslon|bodoni|didot|cormorant|crimson|fraunces|spectral|prata|cardo|domine/i
const stacks = {
  sans: 'Arial, Helvetica, sans-serif',
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

/** How colourful a colour looks: the spread of its channels, 0 to 1. */
function chroma(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255
}

/**
 * Colour roles from a `brand_kits` row, whose colours are an unordered
 * list scraped from the site: the lightest near-white colour is the
 * background, the darkest the ink, the most colourful readable one the
 * accent (buttons need white or black text on it), and `dark` the darkest
 * other colourful one. Missing roles fall back to calm neutrals.
 */
export function brandFromKit(input: {
  name: string
  site?: string
  colors: readonly string[]
  fonts: readonly string[]
  logo?: string
}): BlockBrand {
  const colors = [
    ...new Set(
      input.colors.map((c) => safeColor(c, '')).filter((c): c is string => !!c)
    )
  ]
  const byLight = [...colors].sort((a, b) => luminance(b) - luminance(a))
  const background = byLight.find((c) => luminance(c) >= 0.85) ?? '#fafafa'
  const ink =
    [...byLight].reverse().find((c) => luminance(c) <= 0.05) ?? '#121212'
  const colourful = colors
    .filter((c) => c !== background && c !== ink && chroma(c) >= 0.2)
    .sort((a, b) => chroma(b) - chroma(a))
  const accent = colourful.find((c) => contrast(c, inkOn(c)) >= 4.5) ?? ink
  const dark =
    [...colourful]
      .filter((c) => c !== accent)
      .sort((a, b) => luminance(a) - luminance(b))[0] ?? ink
  return {
    name: input.name.trim() || 'Your brand',
    site: input.site ?? '',
    logo: input.logo,
    font: input.fonts[0] ?? '',
    ink,
    background,
    accent,
    dark: luminance(dark) <= 0.2 ? dark : ink
  }
}
