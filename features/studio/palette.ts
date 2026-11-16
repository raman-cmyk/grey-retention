import { parseFragment } from 'parse5'
import type { DefaultTreeAdapterTypes as T } from 'parse5'
import { readCss } from './css'

/**
 * DST-PIC #13 (owner pick, "Stay on palette"): a designed section's colours
 * come from the brand's palette. Neutrals (white, black, greys) are always
 * fine; any other colour must be a brand colour or a lighter or darker
 * shade of one (its hue within `hueSlack` degrees and its saturation within
 * `saturationSlack`: a vivid colour is no shade of a near-grey one). An off-palette colour
 * is named back to the Section designer with the brand's colours, as its
 * other problems are, so the next try fixes it; a section that keeps
 * failing is drawn as its coded block (D16).
 */

type Rgb = [number, number, number]

/** How far (degrees) a shade's hue may be from its brand colour's. */
export const hueSlack = 15
/** And its saturation (HSL, 0 to 1): a lighter or darker shade keeps about it. */
export const saturationSlack = 0.3
/** Below this saturation (HSL), or this light or dark, a colour is a neutral. */
const neutralSaturation = 0.12
const neutralLight = 0.96
const neutralDark = 0.06

/** Words that name no colour of their own. */
const noColour = new Set([
  'transparent',
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'revert',
  'none'
])
const namedNeutrals: Record<string, Rgb> = {
  white: [255, 255, 255],
  black: [0, 0, 0]
}
/** The CSS colour names (CSS Color 4): only these words in a value are colours. */
const colourNames = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
  blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk
  crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki
  darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue
  dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite
  gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
  lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
  lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
  magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
  mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
  mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
  powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
  seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen
  steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow
  yellowgreen`.split(/\s+/)
)
/** Properties whose value names fonts, never colours. */
const fontProperties = new Set([
  'font',
  'font-family',
  'font-feature-settings',
  'font-variation-settings'
])
/** SVG attributes that paint. */
const paintAttributes = new Set([
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
  'color'
])
const colourToken = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)|\b[a-z]+\b/gi

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

/** A number or a percentage of `max`. */
function channel(part: string, max: number) {
  const p = part.trim()
  const n = Number.parseFloat(p)
  if (!Number.isFinite(n)) return null
  return p.endsWith('%') ? (n / 100) * max : n
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255)) as Rgb
}

/** A colour's red, green and blue (0 to 255), or null for no colour of its own. */
export function parseColour(token: string): Rgb | 'named' | null {
  const t = token.trim().toLowerCase()
  if (noColour.has(t)) return null
  if (t in namedNeutrals) return namedNeutrals[t]!
  if (colourNames.has(t)) return 'named'
  const hex = /^#([0-9a-f]{3,8})$/.exec(t)?.[1]
  if (hex) {
    const full =
      hex.length <= 4
        ? [...hex].map((c) => c + c).join('')
        : hex.length === 6 || hex.length === 8
          ? hex
          : null
    if (!full) return null
    return [0, 2, 4].map((i) =>
      Number.parseInt(full.slice(i, i + 2), 16)
    ) as Rgb
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(t)
  if (!fn) return null
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  if (fn[1]!.startsWith('rgb')) {
    const rgb = parts.slice(0, 3).map((p) => channel(p, 255))
    if (rgb.some((x) => x === null)) return null
    return rgb.map((x) => Math.round(clamp(x!, 0, 255))) as Rgb
  }
  const h = Number.parseFloat(parts[0]!)
  const s = channel(parts[1]!, 1)
  const l = channel(parts[2]!, 1)
  if (!Number.isFinite(h) || s === null || l === null) return null
  return hslToRgb(((h % 360) + 360) % 360, clamp(s, 0, 1), clamp(l, 0, 1))
}

/** Hue (degrees), saturation and lightness (0 to 1). */
function hsl([r, g, b]: Rgb) {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h =
    max === R
      ? ((G - B) / d) % 6
      : max === G
        ? (B - R) / d + 2
        : (R - G) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

const neutral = (c: Rgb) => {
  const { s, l } = hsl(c)
  return s < neutralSaturation || l > neutralLight || l < neutralDark
}
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Every colour a section's styles and SVG paint name, as written. */
export function coloursUsed(section: { html: string; css: string }) {
  const values: string[] = []
  const fromCss = (css: string, inline: boolean) => {
    for (const d of readCss(css, inline).declarations)
      if (!fontProperties.has(d.property)) values.push(d.value)
  }
  fromCss(section.css, false)
  const walk = (node: T.ParentNode) => {
    for (const child of node.childNodes) {
      if (!('tagName' in child)) continue
      const el = child as T.Element
      for (const a of el.attrs) {
        const name = a.name.toLowerCase()
        if (name === 'style') fromCss(a.value, true)
        else if (paintAttributes.has(name)) values.push(a.value)
      }
      walk(el)
    }
  }
  walk(parseFragment(section.html))
  const found: string[] = []
  for (const value of values)
    // A `url(#id)` points at an SVG part, never a colour.
    for (const m of value
      .replace(/url\([^)]*\)/gi, ' ')
      .matchAll(colourToken)) {
      const token = m[0]
      if (/^[a-z]+$/i.test(token) && !colourNames.has(token.toLowerCase()))
        continue
      found.push(token)
    }
  return found
}

const hex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`

/**
 * What is off the brand's palette, in plain words (empty: all on it).
 * `palette` is the brand's colours (hex); a named colour other than white
 * and black is asked for by its hex.
 */
export function paletteProblems(
  section: { html: string; css: string },
  palette: readonly (string | undefined)[]
): string[] {
  const brand = palette.flatMap((p) => {
    const c = p ? parseColour(p) : null
    return c && c !== 'named' ? [c] : []
  })
  const shades = brand.filter((c) => !neutral(c)).map(hsl)
  const off = new Set<string>()
  let named = false
  for (const token of coloursUsed(section)) {
    const c = parseColour(token)
    if (c === null) continue
    if (c === 'named') {
      named = true
      continue
    }
    if (neutral(c)) continue
    const { h, s } = hsl(c)
    if (
      !shades.some(
        (b) =>
          hueGap(b.h, h) <= hueSlack && Math.abs(b.s - s) <= saturationSlack
      )
    )
      off.add(hex(c))
  }
  const own = [...new Set(brand.map(hex))].join(', ')
  const problems: string[] = []
  if (off.size) {
    const list = [...off].slice(0, 3)
    problems.push(
      `The section uses ${list.join(', ')}, off the brand’s palette: use the brand’s colours${own ? ` (${own})` : ''}, a lighter or darker shade of one, or a neutral.`
    )
  }
  if (named)
    problems.push(
      'Name colours by their hex (or white and black), from the brand’s palette.'
    )
  return problems
}
