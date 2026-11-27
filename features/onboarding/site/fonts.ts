import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import { fontFamily as fontName } from '@/features/studio/section'
import { siteHosts } from './fetch-hosts'
import { absolute, words } from './logos'
import { publicHost } from './photos'

/**
 * The brand's real fonts, the site part (owner pick #3, FONT-SITE part a,
 * ledger row FONT-a): the fonts one of the brand's own pages sets its
 * headings and body text in, and where their web-font files are. Pure:
 * the Site reader fetches the page; part b keeps the fonts and fetches
 * the stylesheets listed here (read back through `sheets`); the design
 * studio loads them. Every page and stylesheet is untrusted: a value too
 * long to read whole is refused or dropped, never cut and used; CSS is
 * scanned once left to right, each selector read once, at most
 * `maxTotalCss` characters a call, with no recursion; bad CSS or HTML
 * gives fewer fonts, never an error.
 */

/** Who serves a family's files; `system` is a `local()` font only. */
export type FontKind = 'google' | 'adobe' | 'self-hosted' | 'system' | 'unknown'
export type FontRole = 'heading' | 'body'
export type FontFile = {
  /** Absolute https on a public host: a WOFF2, WOFF, TTF or OTF file. */
  url: string
  format: (typeof formats)[number]
  /** 100 to 900; a variable font's range runs to `maxWeight`. */
  weight: number
  maxWeight?: number
  italic: boolean
  /** The characters it has (its face's `unicode-range`, written plainly), or null for all. */
  unicodeRange: string | null
}
export type SiteFont = {
  /** As the design studio takes a name (its `fontFamily` rule). */
  family: string
  /** What the page sets in it (none: the page only loads it). */
  roles: FontRole[]
  kind: FontKind
  files: FontFile[]
}
export type FontStylesheet = {
  url: string
  from: 'google' | 'adobe' | 'cdn' | 'site'
}
export type SiteFonts = { families: SiteFont[]; stylesheets: FontStylesheet[] }
/** A stylesheet part b read: the address it came from (after redirects) and its text. */
export type Sheet = { url: string; css: string }
/** A file as found: its face's script (0 Latin, 1 Latin Extended, 2 Vietnamese) and its place among the face's formats. */
type Candidate = { file: FontFile; script: number; nth: number }
type FontFace = { family: string; files: Candidate[]; local: boolean }

/** Most families, files per family and stylesheets kept. */
export const maxFamilies = 8
export const maxFontFiles = 12
export const maxStylesheets = 12
/** Most CSS read per block or sheet, and in all in one call; deepest nesting read. */
export const maxCss = 500_000
export const maxTotalCss = 2_000_000
export const maxDepth = 64
/** Most faces, font declarations, custom properties and links read. */
const maxFound = 500
const maxAttr = 500
const maxValue = 2_000
const maxFontUrl = 1_000
const maxRange = 1_000
/** Files kept per weight and style: its best format and one fallback. */
const maxPerStyle = 2

const formats = ['woff2', 'woff', 'truetype', 'opentype'] as const
const extensions = ['woff2', 'woff', 'ttf', 'otf']
const listOrder: FontStylesheet['from'][] = ['google', 'adobe', 'cdn', 'site']
const set = (list: string) => new Set(list.split('|'))
/** Keywords (of families, and of other font values custom properties hold): never a family. */
const generic = set(
  'serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong|inherit|initial|unset|revert|revert-layer|-apple-system|blinkmacsystemfont|default|none|normal|bold|bolder|lighter|italic|oblique|small-caps|auto|block|swap|fallback|optional|left|right|center|start|end|justify|uppercase|lowercase|capitalize|small|medium|large|smaller|larger'
)
/** Fonts on most computers and phones: kept only when the brand serves them. */
const installed = set(
  'arial|arial black|helvetica|helvetica neue|segoe ui|sf pro|sf pro display|sf pro text|tahoma|verdana|georgia|times|times new roman|courier|courier new|trebuchet ms|lucida grande|lucida sans unicode|impact|palatino|oxygen|oxygen-sans|ubuntu|cantarell|droid sans|menlo|monaco|consolas'
)
/** Words of an icon font's name (Material Icons and Symbols, icomoon, slick…). */
const iconWords = set(
  'icon|icons|icomoon|glyph|glyphs|glyphicons|fontawesome|symbols|ionicons|dashicons|fontello|themify|eicons|revicons|socicon|entypo|typicons|linearicons|slick|emoji|judgeme|jdgm'
)
/** Icon fonts by their whole name, spaces and hyphens aside ("Font Awesome 6 Free" starts so). */
const iconNames = /^(?:fontawesome|feather$|stars?$)/
const headingWords = set(
  'h0|h1|h2|h3|h4|h5|h6|heading|headings|headline|headlines|title|titles'
)
const bodyWords = set('body|base|text|paragraph|copy')
/** Words of a custom property that names a font, and the last words of one that names a family. */
const fontWords = set('font|type|typeface|ff|family')
const familyEnds = set('family|stack|primary|typeface')
/** Font CDNs whose stylesheets are read (part b fetches them too). */
export const fontCdns = set(
  'fonts.bunny.net|fast.fonts.net|cloud.typography.com|fonts.cdnfonts.com'
)
/** Who serves files on these hosts; any other host's are the brand's own. */
const fileHosts: Partial<Record<string, FontKind>> = {
  'fonts.gstatic.com': 'google',
  'use.typekit.net': 'adobe'
}

type Node = T.ChildNode | T.ParentNode
const isElement = (n: Node): n is T.Element => 'tagName' in n
const attr = (n: T.Element, name: string) =>
  n.attrs.find((a) => a.name === name)?.value ?? null
const short = (n: T.Element, name: string) =>
  attr(n, name)?.slice(0, maxAttr) ?? null
const children = (n: Node): T.ChildNode[] =>
  'childNodes' in n ? n.childNodes : []
const textOf = (n: T.Element) =>
  children(n)
    .map((t) => ('value' in t ? t.value : ''))
    .join('')
/** At most `n` characters, never a part cut off: what follows the last `sep` is dropped. */
const cutAt = (text: string, n: number, sep: string) =>
  text.length <= n ? text : text.slice(0, text.lastIndexOf(sep, n - 1) + 1)

/** Where a CSS string that starts at `i` ends (its quote, a line end, or the end). */
function stringEnd(s: string, i: number) {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') j++
    else if (s[j] === s[i] || s[j] === '\n') return j
  }
  return s.length
}

/** Splits at `sep` outside strings and brackets. */
export function split(text: string, sep: ',' | ';' | ' ') {
  const out: string[] = []
  let parens = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'") i = stringEnd(text, i)
    else if (c === '(') parens++
    else if (c === ')') parens = Math.max(0, parens - 1)
    else if (c === sep && parens === 0) {
      out.push(text.slice(from, i))
      from = i + 1
    }
  }
  return [...out, text.slice(from)]
}

/** CSS without its comments (a `/*` in a string is no comment). */
function uncommented(css: string) {
  let out = ''
  let from = 0
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '"' || css[i] === "'") i = stringEnd(css, i)
    else if (css[i] === '/' && css[i + 1] === '*') {
      out += css.slice(from, i) + ' '
      const close = css.indexOf('*/', i + 2)
      if (close < 0) return out
      i = close + 1
      from = close + 2
    }
  }
  return out + css.slice(from)
}

/**
 * Reads CSS once, left to right: each rule's prelude (`h1`, `@font-face`)
 * read once by `open`, then its declarations by `rule` (in parts, when
 * nested rules split them), and each top-level statement (`@import …`).
 * Strings and brackets are skipped as CSS reads them; nesting deeper than
 * `maxDepth` is counted, not read; a rule never closed is not read.
 * `open` is also told how deep the rule is (0: top level), so a caller can
 * keep the rules it sits in (PICK-006 reads none inside a width query).
 */
export function scanCss<C>(
  css: string,
  open: (prelude: string, depth: number) => C,
  rule: (at: C, body: string) => void,
  statement: (text: string) => void
) {
  const s = uncommented(css)
  const opened: C[] = []
  let [depth, start, semi, parens] = [0, 0, -1, 0]
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '"' || c === "'") i = stringEnd(s, i)
    else if (c === '(') parens++
    else if (c === ')') parens = Math.max(0, parens - 1)
    else if (c === ';' && parens === 0 && depth > 0) semi = i
    else if (c === ';' && parens === 0) {
      statement(s.slice(start, i))
      start = i + 1
    } else if (c === '{' || c === '}') {
      // A nested rule ends its parent's declarations before it.
      const head = c === '{' && semi >= start ? semi + 1 : c === '{' ? start : i
      if (depth > 0 && depth <= maxDepth && head > start)
        rule(opened[depth - 1]!, s.slice(start, head))
      if (c === '{' && depth < maxDepth)
        opened[depth] = open(
          cutAt(s.slice(head, i), maxValue, ',').trim(),
          depth
        )
      depth = c === '{' ? depth + 1 : Math.max(0, depth - 1)
      ;[start, semi, parens] = [i + 1, -1, 0]
    }
  }
  // The last statement needs no `;` (`@import url(fonts.css)` at the end).
  if (depth === 0 && start < s.length) statement(s.slice(start))
}

export function declarations(body: string): [string, string][] {
  return split(body, ';').flatMap((part): [string, string][] => {
    const colon = part.indexOf(':')
    if (colon < 0) return []
    let value = part.slice(colon + 1).trim()
    const bang = value.lastIndexOf('!')
    if (bang >= 0 && /^!\s*important$/i.test(value.slice(bang)))
      value = value.slice(0, bang).trim()
    const name = part.slice(0, colon).trim()
    // Custom properties keep their case, as CSS reads them.
    return [[name.startsWith('--') ? name : name.toLowerCase(), value]]
  })
}

/** A family name the studio can take, or null: a keyword, an unquoted number, an icon font. */
function familyName(raw: string) {
  if (raw.length > maxValue) return null
  let name = raw.trim()
  const quoted =
    /^["']/.test(name) && name.length > 1 && name.endsWith(name[0]!)
  if (quoted) name = name.slice(1, -1)
  name = name.replace(/\s+/g, ' ').trim()
  const lower = name.toLowerCase()
  if (generic.has(lower) || !fontName.test(name)) return null
  // Unquoted, a name never starts with a digit (`20px`, `2rem` are sizes).
  if ((!quoted && /^\d/.test(name)) || /^\d+$/.test(name)) return null
  if (iconNames.test(lower.replace(/[\s-]/g, ''))) return null
  return words(name).some((w) => iconWords.has(w)) ? null : name
}

const varRef = /^var\(\s*(--[\w-]{1,100})\s*(?:,([^]*))?\)$/i

/** The family a value sets: its list's first (the rest are fallbacks), through `var()`s. */
function resolve(value: string, props: Map<string, string>) {
  let v = value
  for (let hop = 0; hop < 4 && v.length <= maxValue; hop++) {
    const first = (split(v, ',')[0] ?? '').trim()
    const ref = varRef.exec(first)
    if (!ref) return familyName(first)
    v = props.get(ref[1]!) ?? ref[2] ?? ''
  }
  return null
}

const fontSize =
  /^(?:[\d.]+(?:px|r?em|%|pt|pc|vw|vh|vmin|vmax|ch|ex)|(?:x{1,3}-)?(?:small|large)|medium|smaller|larger|(?:calc|clamp|min|max)\(.*\))$/i

/** The family list of a `font` shorthand: what follows its size (and line height). */
function shorthand(value: string) {
  if (value.length > maxValue) return ''
  const t = split(value.replace(/\//g, ' / ').replace(/\s+/g, ' ').trim(), ' ')
  // A `var()` is the size only before a line height.
  const size = t.findIndex(
    (x, i) => fontSize.test(x) || (/^var\(/i.test(x) && t[i + 1] === '/')
  )
  if (size < 0) return ''
  return t.slice(t[size + 1] === '/' ? size + 3 : size + 1).join(' ')
}

/** What a selector list sets: headings (`h1`, `.h2`, `.section-heading`), the body (`html`, `body`, `:root`). */
function selectorRoles(prelude: string): FontRole[] {
  const roles = new Set<FontRole>()
  for (const selector of split(prelude, ',').slice(0, 50)) {
    // What a selector excludes or only contains is not what it sets.
    const own = selector.replace(/:(?:not|has)\([^()]*\)/gi, '').trim()
    const parts = own.split(/[\s>+~]+/)
    const last = parts[parts.length - 1] ?? ''
    const tag = /^[a-z][a-z0-9]*/i.exec(last)?.[0].toLowerCase()
    if (last === ':root' || tag === 'html' || tag === 'body') roles.add('body')
    else if (words(last).some((w) => headingWords.has(w))) roles.add('heading')
  }
  return [...roles]
}

const roleOf = (w: readonly string[]): FontRole | undefined =>
  w.some((x) => headingWords.has(x) || x === 'header')
    ? 'heading'
    : w.some((x) => bodyWords.has(x))
      ? 'body'
      : undefined

/**
 * A custom property naming a font family: one whose name ends so (family,
 * stack, primary or typeface, then perhaps a role: `--font-heading-family`,
 * `--typeHeaderPrimary`, `--font-stack-header`), or `--font-<role>`. Its
 * role (null: none), or undefined when it names no family (`--font-display`
 * holds `swap`, `--font-heading-stretch` holds `condensed`).
 */
function propRole(name: string): FontRole | null | undefined {
  const w = words(name)
  const [last, before] = [w[w.length - 1] ?? '', w[w.length - 2] ?? '']
  const named =
    familyEnds.has(last) ||
    (familyEnds.has(before) && roleOf([last])) ||
    (w.length === 2 && w[0] === 'font' && roleOf([last]))
  if (!named || !w.some((x) => fontWords.has(x))) return
  return roleOf(w) ?? (w.includes('display') ? 'heading' : null)
}

/** The role a custom property sets a weight for (`--font-heading-weight`). */
function weightRole(name: string) {
  const w = words(name)
  if (w.includes('weight') && w.some((x) => fontWords.has(x))) return roleOf(w)
}

/** An https address on a public host, with no name, password or port, or null. */
function publicHttps(url: string | null) {
  if (!url || url.length > maxFontUrl) return null
  try {
    const u = new URL(url)
    const safe = !u.username && !u.password && u.port === ''
    return u.protocol === 'https:' && safe && publicHost(u.hostname) ? u : null
  } catch {
    return null
  }
}

/** One `src` entry's file (`url(…) format(…)`): a WOFF2, WOFF, TTF or OTF on a public https host. */
function fontFile(entry: string, base: string) {
  if (!/^url\s*\(/i.test(entry)) return null
  let rest = entry.slice(entry.indexOf('(') + 1).trimStart()
  const quoted = rest[0] === '"' || rest[0] === "'"
  const end = quoted ? stringEnd(rest, 0) : rest.indexOf(')')
  if (end < 0 || end - +quoted > maxFontUrl) return null
  const u = publicHttps(absolute(rest.slice(+quoted, end), base))
  rest = rest.slice(end, end + 200)
  const hint = /format\s*\(\s*["']?([a-z0-9-]{1,40})/i.exec(rest)?.[1]
  const ext = /\.([a-z0-9]{1,6})$/i.exec(u?.pathname ?? '')?.[1]
  // Named for its format, or (Adobe's) named for none with its format given.
  const format = ext
    ? formats[extensions.indexOf(ext.toLowerCase())]
    : formats.find((f) => hint?.toLowerCase().startsWith(f))
  return u && format ? { url: u.href, format } : null
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')

/**
 * A face's `unicode-range` as CSS reads it: its spans, written plainly
 * (`U+0000-00FF, U+0131`), or null for every character (none, empty or
 * invalid: CSS then ignores it); undefined when too long to keep whole.
 */
function readRange(value: string | undefined) {
  const spans: [number, number][] = []
  for (const part of value?.trim() ? split(value, ',') : []) {
    const m = /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(part.trim())
    const wild = m?.[1]?.includes('?')
    if (!m || (wild && (m[2] || !/^[0-9a-f]*\?+$/i.test(m[1]!)))) return null
    const lo = parseInt(m[1]!.replace(/\?/g, '0'), 16)
    const hi = parseInt((m[2] ?? m[1]!).replace(/\?/g, 'f'), 16)
    if (lo > hi || hi > 0x10ffff) return null
    spans.push([lo, hi])
  }
  if (!spans.length) return null
  const text = spans
    .map(([lo, hi]) => `U+${hex(lo)}${hi > lo ? `-${hex(hi)}` : ''}`)
    .join(', ')
  return text.length > maxRange ? undefined : { spans, text }
}

/** A face's script: 0 the Latin letters (A, Z, a, z), 1 Latin Extended (ł, ř, ş), 2 Vietnamese (ạ), 3 none of them. */
function scriptOf(range: ReturnType<typeof readRange>) {
  if (!range) return range === null ? 0 : 3
  const has = (p: number) => range.spans.some(([lo, hi]) => lo <= p && p <= hi)
  if ([0x41, 0x5a, 0x61, 0x7a].every(has)) return 0
  if ([0x142, 0x159, 0x15f].some(has)) return 1
  return has(0x1ea1) ? 2 : 3
}

/** Whether a file has the Latin letters: its range holds A, Z, a and z, or every character. */
export const latinFile = (file: Pick<FontFile, 'unicodeRange'>) =>
  scriptOf(readRange(file.unicodeRange ?? undefined)) === 0

/** Compares two lists of numbers, first number first. */
function byKeys(a: readonly number[], b: readonly number[]) {
  for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j]! - b[j]!
  return 0
}

function readFace(body: string, base: string): FontFace | null {
  const d = new Map(declarations(body))
  const family = familyName(d.get('font-family') ?? '')
  if (!family) return null
  const [weight, maxWeight] = (d.get('font-weight') ?? '')
    .toLowerCase()
    .split(/\s+/, 2)
    .map((p) => (p === 'bold' ? 700 : p === 'normal' ? 400 : Number(p)))
    .filter((n) => n >= 1 && n <= 1000)
    .map((n) => Math.min(900, Math.max(100, Math.round(n))))
  const italic = /^(?:italic|oblique)\b/i.test(d.get('font-style') ?? '')
  const entries = split(d.get('src') ?? '', ',').map((e) => e.trim())
  const range = readRange(d.get('unicode-range'))
  const script = scriptOf(range)
  // A face for other scripts (Google's Cyrillic, Greek…) has no file the studio can use.
  const files = (script < 3 ? entries.slice(0, 20) : [])
    .map((e) => fontFile(e, base))
    .filter((f) => f !== null)
    .slice(0, 4)
    .sort((a, b) => formats.indexOf(a.format) - formats.indexOf(b.format))
    .map((f, nth) => ({
      file: {
        ...f,
        weight: weight ?? 400,
        ...(maxWeight! > weight! ? { maxWeight } : {}),
        italic,
        unicodeRange: range?.text ?? null
      },
      script,
      nth
    }))
  return { family, files, local: entries.some((e) => /^local\s*\(/i.test(e)) }
}

type Found = {
  usages: { role: FontRole | null; value: string }[]
  props: Map<string, string>
  faces: FontFace[]
  links: [string | null, string][]
  /** The weights the page sets for each role. */
  weights: Record<FontRole, Set<number>>
  /** CSS characters still to read in this call. */
  budget: number
}

function weigh(f: Found, roles: readonly FontRole[], value: string) {
  const v = value.trim().toLowerCase()
  const n =
    v === 'bold' ? 700 : v === 'normal' ? 400 : /^\d{3}$/.test(v) ? +v : 0
  if (n >= 100 && n <= 900) for (const role of roles) f.weights[role].add(n)
}

/** What a rule's or a style attribute's declarations say about fonts. */
function fontDeclarations(body: string, roles: readonly FontRole[], f: Found) {
  for (const [name, value] of declarations(body)) {
    const room = f.usages.length < maxFound
    if (name.startsWith('--')) {
      if (f.props.size < maxFound && !f.props.has(name))
        f.props.set(name, value)
      const role = room ? propRole(name) : undefined
      if (role !== undefined) f.usages.push({ role, value })
      const weighed = weightRole(name)
      if (weighed) weigh(f, [weighed], value)
    } else if (name === 'font-weight') weigh(f, roles, value)
    else if (room && (name === 'font-family' || name === 'font')) {
      const list = name === 'font' ? shorthand(value) : value
      for (const role of roles) f.usages.push({ role, value: list })
    }
  }
}

function readCss(css: string, base: string, f: Found) {
  const text = css.slice(0, Math.min(maxCss, f.budget))
  f.budget -= text.length
  scanCss(
    text,
    // A face (null) or the roles of a rule, read once per rule.
    (prelude) =>
      prelude.toLowerCase() === '@font-face' ? null : selectorRoles(prelude),
    (roles, body) => {
      if (roles) fontDeclarations(body, roles, f)
      else if (f.faces.length < maxFound) {
        const face = readFace(body, base)
        if (face) f.faces.push(face)
      }
    },
    (statement) => {
      // A whole address only: one longer than the studio takes is refused, never cut.
      const at =
        /^\s*@import\s+(?:url\(\s*)?["']?([^"'()\s]{1,1000})["')\s]/i.exec(
          statement.slice(0, maxFontUrl + 100)
        )
      if (at && f.links.length < maxFound) f.links.push([at[1]!, base])
    }
  )
}

/**
 * The brand's fonts on one page, heading fonts first, then body fonts,
 * then fonts it only loads, each with its kind and files: from the page's
 * own `<style>` blocks and `style` attributes, its Google Fonts links, and
 * the `sheets` passed back (part b fetches `stylesheets`; each `url` is
 * the address it was read from, after redirects, as its addresses are read
 * from it). Never keyword or system families (Arial, `-apple-system`),
 * icon fonts, `data:` files, or files that are not WOFF2, WOFF, TTF or OTF
 * over https on a public host. Stylesheets listed: Google's, Adobe's,
 * known font CDNs', then the brand's own host's (and its store platform's).
 */
export function siteFonts(
  html: string,
  page: string,
  { sheets = [] }: { sheets?: readonly Sheet[] } = {}
): SiteFonts {
  try {
    return read(html, page, sheets)
  } catch {
    return { families: [], stylesheets: [] }
  }
}

function read(html: string, page: string, sheets: readonly Sheet[]) {
  const own = siteHosts(new URL(page).hostname)
  const f: Found = {
    usages: [],
    props: new Map(),
    faces: [],
    links: [],
    weights: { heading: new Set(), body: new Set() },
    budget: maxTotalCss
  }
  // Walked with a list, not recursion: a page nested thousands deep is still read.
  const stack = [...children(parse(html.slice(0, 2_000_000)))].reverse()
  while (stack.length) {
    const c = stack.pop()!
    if (!isElement(c)) continue
    const tag = c.tagName
    const rel = tag === 'link' ? (short(c, 'rel') ?? '').toLowerCase() : ''
    const rels = rel.split(/\s+/)
    const as = rels.includes('preload') ? short(c, 'as')?.toLowerCase() : null
    if (tag === 'style') readCss(textOf(c), page, f)
    else if (rels.includes('stylesheet') || as === 'style')
      f.links.push([attr(c, 'href'), page])
    else if (tag === 'script') {
      // Adobe's older embed: a kit's script, beside its stylesheet of the same name.
      const kit =
        /^(?:https:)?\/\/use\.typekit\.net\/([a-z0-9]{1,20})\.js$/i.exec(
          (short(c, 'src') ?? '').trim()
        )
      if (kit) f.links.push([`https://use.typekit.net/${kit[1]}.css`, page])
    }
    const role = /^h[1-6]$/.test(tag) ? 'heading' : 'body'
    if (role === 'heading' || tag === 'body' || tag === 'html')
      fontDeclarations(cutAt(attr(c, 'style') ?? '', maxAttr, ';'), [role], f)
    const kids = children(c)
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
  }
  for (const sheet of sheets.slice(0, maxStylesheets))
    readCss(sheet.css, sheet.url, f)

  const google: string[] = []
  const listed = new Map<string, FontStylesheet['from']>()
  for (const [href, base] of f.links.slice(0, maxFound)) {
    const u = href && href.length <= maxFontUrl ? absolute(href, base) : null
    const url = publicHttps(u)
    const host = url?.hostname ?? ''
    if (!url || listed.has(url.href)) continue
    if (host === 'fonts.googleapis.com' && /^\/css2?$/.test(url.pathname)) {
      const named = url.searchParams
        .getAll('family')
        .slice(0, 10)
        .flatMap((v) => v.split('|').slice(0, 10))
        .map((v) => familyName(v.split(':')[0]!))
        .filter((n) => n !== null)
      google.push(...named)
      if (named.length) listed.set(url.href, 'google')
    } else if (host === 'use.typekit.net') {
      if (/^\/[a-z0-9]{1,20}\.css$/i.test(url.pathname))
        listed.set(url.href, 'adobe')
    } else if (fontCdns.has(host)) listed.set(url.href, 'cdn')
    else if (own.has(host) || host === 'cdn.shopify.com')
      listed.set(url.href, 'site')
  }

  type Entry = Pick<SiteFont, 'family'> & { found: Candidate[] } & Record<
      'first' | FontRole,
      number
    > & { local: boolean; google: boolean }
  const byKey = new Map<string, Entry>()
  const entry = (family: string) => {
    const key = family.toLowerCase()
    const e = byKey.get(key) ?? {
      family,
      found: [],
      first: byKey.size,
      heading: Infinity,
      body: Infinity,
      local: false,
      google: false
    }
    byKey.set(key, e)
    return e
  }
  f.usages.forEach(({ role, value }, i) => {
    const family = resolve(value, f.props)
    const e = family ? entry(family) : null
    if (e && role) e[role] = Math.min(e[role], i)
  })
  for (const face of f.faces) {
    const e = entry(face.family)
    e.family = face.family // the site's own spelling, as its files declare it
    e.local ||= face.local
    if (e.found.length < maxFound) e.found.push(...face.files)
  }
  for (const name of google) entry(name).google = true

  /**
   * A family's files, best first: upright before italic, then the weights
   * the page sets for its roles, then those nearest 400 and 700; in each
   * weight and style its Latin face's best file, then its Latin Extended
   * face's (else Vietnamese), else another format.
   */
  const filesOf = (e: Entry) => {
    const used = (['heading', 'body'] as const).flatMap((r) =>
      e[r] < Infinity ? [...f.weights[r]] : []
    )
    const off = (x: FontFile, w: number) =>
      Math.max(0, x.weight - w, w - (x.maxWeight ?? x.weight))
    const ranked = e.found
      .map(({ file: x, script, nth }, i) => ({
        x,
        k: [
          +x.italic,
          used.some((w) => !off(x, w)) ? 0 : 1,
          Math.min(off(x, 400), off(x, 700)),
          x.weight,
          +(nth > 0),
          script,
          i
        ]
      }))
      .sort((a, b) => byKeys(a.k, b.k))
    const kept: FontFile[] = []
    for (const { x } of ranked) {
      if (kept.length >= maxFontFiles) break
      const style = kept.filter(
        (k) => k.weight === x.weight && k.italic === x.italic
      )
      if (style.length < maxPerStyle && !kept.some((k) => k.url === x.url))
        kept.push(x)
    }
    return kept
  }
  // Heading fonts first, then body fonts, then the rest, each as found.
  const rank = (e: Entry) => Math.min(e.heading, 1e6 + e.body, 2e6 + e.first)
  const families = [...byKey.values()]
    .map((e) => ({ e, files: filesOf(e) }))
    // A font on most devices counts only when the brand serves it (or Google does).
    .filter(
      ({ e, files }) =>
        files.length || e.google || !installed.has(e.family.toLowerCase())
    )
    .sort((a, b) => rank(a.e) - rank(b.e))
    .slice(0, maxFamilies)
    .map(({ e, files }) => ({
      family: e.family,
      roles: (['heading', 'body'] as const).filter((r) => e[r] < Infinity),
      kind: files[0]
        ? (fileHosts[new URL(files[0].url).hostname] ?? 'self-hosted')
        : e.google
          ? 'google'
          : e.local
            ? 'system'
            : 'unknown',
      files
    }))
  // Font services first, so the brand's own stylesheets never crowd them out.
  const stylesheets = [...listed]
    .map(([url, from]) => ({ url, from }))
    .sort((a, b) => listOrder.indexOf(a.from) - listOrder.indexOf(b.from))
    .slice(0, maxStylesheets)
  return { families, stylesheets }
}
