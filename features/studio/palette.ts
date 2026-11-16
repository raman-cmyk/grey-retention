import { parseFragment } from 'parse5'
import type { DefaultTreeAdapterTypes as T } from 'parse5'
import { readCss } from './css'

/**
 * DST-PIC #13 (owner pick, "Stay on palette"): a designed section's colours
 * come from the brand's palette. A neutral (white, black, a grey, a cream:
 * little colour of its own) is always fine; any other colour must be a
 * brand colour or a lighter or darker shade of one: its hue within
 * `hueSlack` degrees and no more colourful than the brand colour by
 * `chromaSlack`. Colour is measured as chroma (the spread between the
 * strongest and weakest of red, green and blue, as the brand kit's roles
 * are found), which stays small for greys and creams and only falls when a
 * colour is mixed with white or black. An off-palette colour is named back
 * to the Section designer with the brand's colours, as its other problems
 * are, so the next try fixes it; a section that keeps failing is drawn as
 * its coded block (D16). A colour written in a way this reader cannot read
 * for sure (`oklch()`, a relative colour, `calc()` inside) is refused
 * rather than guessed at, as the styles are; a colour name or a system
 * colour is asked for by its hex.
 */

type Rgb = [number, number, number]
export type Colour =
  | { rgb: Rgb; clear: boolean }
  /** A colour name or a system colour: asked for by its hex. */
  | 'named'
  /** A colour this reader does not read for sure. */
  | 'unread'

/** How far (degrees) a shade's hue may be from its brand colour's. */
export const hueSlack = 15
/** Below this chroma (0 to 1) a colour is a neutral. */
export const neutralChroma = 0.12
/** How much more colourful than its brand colour a shade may be. */
export const chromaSlack = 0.15

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
/** The CSS colour names (CSS Color 4) and system colours: only these words in a value are colours. */
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
  yellowgreen canvas canvastext linktext visitedtext activetext buttonface buttontext
  buttonborder field fieldtext highlight highlighttext selecteditem selecteditemtext mark
  marktext graytext accentcolor accentcolortext`.split(/\s+/)
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
/** Colour functions: rgb and hsl are read, the rest refused. */
const colourFunctions =
  'rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk'
const colourToken = new RegExp(
  `\\b(?:${colourFunctions})\\([^()]*(?:\\([^()]*\\)[^()]*)*\\)|#[0-9a-f]{3,8}\\b|\\b[a-z]+\\b`,
  'gi'
)

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

/** A plain number, a percentage of `max`, or `none` (0); null for anything else. */
function channel(part: string, max: number) {
  const p = part.trim().toLowerCase()
  if (p === 'none') return 0
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)%?$/.test(p)) return null
  const n = Number.parseFloat(p)
  return p.endsWith('%') ? (n / 100) * max : n
}

/** A hue in degrees from `deg` (or no unit), `turn`, `rad` or `grad`, or `none`. */
function hue(part: string) {
  const p = part.trim().toLowerCase()
  if (p === 'none') return 0
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad|grad)?$/.exec(p)
  if (!m) return null
  const n = Number.parseFloat(m[1]!)
  const deg =
    m[2] === 'turn'
      ? n * 360
      : m[2] === 'rad'
        ? (n * 180) / Math.PI
        : m[2] === 'grad'
          ? n * 0.9
          : n
  return ((deg % 360) + 360) % 360
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255)) as Rgb
}

/** A colour's red, green and blue (0 to 255) and whether it paints nothing; null for no colour of its own. */
export function parseColour(token: string): Colour | null {
  const t = token.trim().toLowerCase()
  if (noColour.has(t)) return null
  if (t in namedNeutrals) return { rgb: namedNeutrals[t]!, clear: false }
  if (colourNames.has(t)) return 'named'
  const hex = /^#([0-9a-f]{3,8})$/.exec(t)?.[1]
  if (hex) {
    const full =
      hex.length <= 4
        ? [...hex].map((c) => c + c).join('')
        : hex.length === 6 || hex.length === 8
          ? hex
          : null
    if (!full) return 'unread'
    const rgb = [0, 2, 4].map((i) =>
      Number.parseInt(full.slice(i, i + 2), 16)
    ) as Rgb
    return { rgb, clear: full.length === 8 && full.endsWith('00') }
  }
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(t)
  if (!fn) return 'unread'
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3 || parts.length > 4) return 'unread'
  const alpha = parts[3] === undefined ? 1 : channel(parts[3], 1)
  if (alpha === null) return 'unread'
  const clear = alpha <= 0
  if (fn[1]!.startsWith('rgb')) {
    const rgb = parts.slice(0, 3).map((p) => channel(p, 255))
    if (rgb.some((x) => x === null)) return 'unread'
    return {
      rgb: rgb.map((x) => Math.round(clamp(x!, 0, 255))) as Rgb,
      clear
    }
  }
  // HSL's saturation and lightness are percentages, a plain number too.
  const percent = (p: string) =>
    channel(/%$/.test(p) || p === 'none' ? p : `${p}%`, 1)
  const h = hue(parts[0]!)
  const s = percent(parts[1]!)
  const l = percent(parts[2]!)
  if (h === null || s === null || l === null) return 'unread'
  return { rgb: hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1)), clear }
}

/** Hue (degrees) and chroma (0 to 1). */
function hueChroma([r, g, b]: Rgb) {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const c = max - min
  if (!c) return { h: 0, c: 0 }
  const h =
    max === R
      ? ((G - B) / c) % 6
      : max === G
        ? (B - R) / c + 2
        : (R - G) / c + 4
  return { h: (h * 60 + 360) % 360, c }
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
 * `palette` is the brand's colours (hex).
 */
export function paletteProblems(
  section: { html: string; css: string },
  palette: readonly (string | undefined)[]
): string[] {
  const brand = palette.flatMap((p) => {
    const c = p ? parseColour(p) : null
    return c && typeof c === 'object' ? [c.rgb] : []
  })
  const shades = brand.map(hueChroma).filter((b) => b.c >= neutralChroma)
  const off = new Set<string>()
  const unread = new Set<string>()
  let named = false
  for (const token of coloursUsed(section)) {
    const c = parseColour(token)
    if (c === null) continue
    if (c === 'named') {
      named = true
      continue
    }
    if (c === 'unread') {
      unread.add(token.slice(0, 40))
      continue
    }
    if (c.clear) continue
    const { h, c: chroma } = hueChroma(c.rgb)
    if (chroma < neutralChroma) continue
    if (
      !shades.some(
        (b) => hueGap(b.h, h) <= hueSlack && chroma <= b.c + chromaSlack
      )
    )
      off.add(hex(c.rgb))
  }
  const own = [...new Set(brand.map(hex))].join(', ')
  const problems: string[] = []
  if (off.size) {
    const list = [...off]
    const more = list.length > 3 ? ` and ${list.length - 3} more` : ''
    problems.push(
      `The section uses ${list.slice(0, 3).join(', ')}${more}, off the brand’s palette: use the brand’s colours${own ? ` (${own})` : ''}, a lighter or darker shade of one, or a neutral.`
    )
  }
  if (named)
    problems.push(
      'Name colours by their hex (or white and black), from the brand’s palette.'
    )
  if (unread.size)
    problems.push(
      `Write each colour as a hex (or rgb, hsl): ${[...unread]
        .slice(0, 3)
        .map((u) => `“${u}”`)
        .join(', ')} cannot be read for sure.`
    )
  return problems
}
