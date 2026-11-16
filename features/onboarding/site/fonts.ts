import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'
import { siteHosts } from './fetch-hosts'
import { absolute, words } from './logos'
import { publicHost } from './photos'

/**
 * The brand's real fonts, the site part (owner pick #3, FONT-SITE part a):
 * the fonts one of the brand's own pages sets its headings and body text
 * in, and where their web-font files are. Pure: the Site reader fetches
 * the page; part b keeps the fonts and fetches the stylesheets listed
 * here (read back through `sheets`, with the same caps); the design
 * studio loads them. Every
 * page and stylesheet is untrusted: values are cut before they are read,
 * CSS is scanned once left to right (no recursion, no pattern a hostile
 * text can make slow), and bad CSS or HTML gives fewer fonts, never an error.
 */

/** Who serves a family's files; `system` is a `local()` font only. */
export type FontKind = 'google' | 'adobe' | 'self-hosted' | 'system' | 'unknown'
export type FontFile = {
  /** Absolute https on a public host: a WOFF2, WOFF, TTF or OTF file. */
  url: string
  format: (typeof formats)[number]
  /** 100 to 900; a variable font's range runs to `maxWeight`. */
  weight: number
  maxWeight?: number
  italic: boolean
}
export type SiteFont = {
  /** As the design studio takes a name: letters, digits, spaces and hyphens, at most 60. */
  family: string
  /** What the page sets in it (none: the page only loads it). */
  roles: Role[]
  kind: FontKind
  files: FontFile[]
}
export type FontStylesheet = {
  url: string
  from: 'google' | 'adobe' | 'site' | 'cdn'
}
export type SiteFonts = { families: SiteFont[]; stylesheets: FontStylesheet[] }
type FontFace = { family: string; files: FontFile[]; local: boolean }
type Role = 'heading' | 'body'

/** Most families, files per family and stylesheets kept; most CSS read per block or sheet. */
export const maxFamilies = 8
export const maxFontFiles = 12
export const maxStylesheets = 12
export const maxCss = 500_000
/** Most faces, font declarations, custom properties and links read. */
const maxFound = 500
const maxAttr = 500
const maxValue = 2_000
const maxDepth = 64
const maxFontUrl = 1_000

const formats = ['woff2', 'woff', 'truetype', 'opentype'] as const
const extensions = ['woff2', 'woff', 'ttf', 'otf']
const set = (list: string) => new Set(list.split('|'))
/** The design studio's own rule for a font name (`features/studio/section.ts`). */
const fontName = /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/
/** Keywords and system stacks: never a brand's choice. */
const generic = set(
  'serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong|inherit|initial|unset|revert|revert-layer|-apple-system|blinkmacsystemfont|default|none|normal|bold|italic'
)
/** Fonts on most computers and phones: kept only when the brand serves a file. */
const installed = set(
  'arial|arial black|helvetica|helvetica neue|segoe ui|sf pro|sf pro display|sf pro text|tahoma|verdana|georgia|times|times new roman|courier|courier new|trebuchet ms|lucida grande|lucida sans unicode|impact|palatino|oxygen|oxygen-sans|ubuntu|cantarell|droid sans|menlo|monaco|consolas'
)
/** Words of an icon font's name (Font Awesome, Material Icons, icomoon, slick…). */
const iconWords = set(
  'icon|icons|icomoon|glyph|glyphs|glyphicons|awesome|fontawesome|symbols|ionicons|dashicons|fontello|themify|eicons|revicons|socicon|entypo|typicons|linearicons|star|stars|slick|feather|emoji'
)
const headingWords = set(
  'h0|h1|h2|h3|h4|h5|h6|heading|headings|headline|headlines|title|titles'
)
const bodyWords = set('body|base|text|paragraph|copy')
/** Words of a custom property about a font that holds no family (`--font-heading-weight`). */
const notFamily = set(
  'size|sizes|weight|style|scale|height|line|spacing|letter|color|variation|feature|features|smoothing|transform|case'
)
const fontCdns = set(
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

/** Where a CSS string that starts at `i` ends (its quote, a line end, or the end). */
function stringEnd(s: string, i: number) {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') j++
    else if (s[j] === s[i] || s[j] === '\n') return j
  }
  return s.length
}

/** Splits at `sep` outside strings and brackets. */
function split(text: string, sep: ',' | ';') {
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

function uncommented(css: string) {
  let out = ''
  for (let i = 0; ;) {
    const open = css.indexOf('/*', i)
    if (open < 0) return out + css.slice(i)
    out += css.slice(i, open) + ' '
    const close = css.indexOf('*/', open + 2)
    if (close < 0) return out
    i = close + 2
  }
}

/**
 * Reads CSS once, left to right: each rule's own prelude (`h1`,
 * `@font-face`) with its declarations, and each top-level statement
 * (`@import …`). Strings and brackets are skipped as CSS reads them;
 * nesting deeper than `maxDepth` is counted, not read.
 */
function scanCss(
  css: string,
  rule: (prelude: string, body: string) => void,
  statement: (text: string) => void
) {
  const s = uncommented(css.slice(0, maxCss))
  const preludes: string[] = []
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
        rule(preludes[depth - 1]!, s.slice(start, head))
      if (c === '{' && depth < maxDepth)
        preludes[depth] = s.slice(head, Math.min(i, head + maxValue)).trim()
      depth = c === '{' ? depth + 1 : Math.max(0, depth - 1)
      ;[start, semi, parens] = [i + 1, -1, 0]
    }
  }
}

function declarations(body: string): [string, string][] {
  return split(body, ';').flatMap((part): [string, string][] => {
    const colon = part.indexOf(':')
    if (colon < 0) return []
    let value = part.slice(colon + 1).trim()
    if (value.slice(-10).toLowerCase() === '!important')
      value = value.slice(0, -10).trim()
    const name = part.slice(0, colon).trim()
    // Custom properties keep their case, as CSS reads them.
    return [[name.startsWith('--') ? name : name.toLowerCase(), value]]
  })
}

/** A family name the studio can take, or null: a keyword, a system stack, an icon font. */
function familyName(raw: string) {
  let name = raw.slice(0, maxValue).trim()
  if (/^["']/.test(name) && name.length > 1 && name.endsWith(name[0]!))
    name = name.slice(1, -1)
  name = name.replace(/\s+/g, ' ').trim()
  if (generic.has(name.toLowerCase()) || !fontName.test(name)) return null
  if (/^\d+$/.test(name) || words(name).some((w) => iconWords.has(w)))
    return null
  return name
}

const varRef = /^var\(\s*(--[\w-]{1,100})\s*(?:,([^]*))?\)$/i

/** The family a value sets: its list's first (the rest are fallbacks), through `var()`s. */
function resolve(value: string, props: Map<string, string>) {
  let v = value
  for (let hop = 0; hop < 4; hop++) {
    const first = (split(v.slice(0, maxValue), ',')[0] ?? '').trim()
    const ref = varRef.exec(first)
    if (!ref) return familyName(first)
    v = props.get(ref[1]!) ?? ref[2] ?? ''
  }
  return null
}

/** The family list of a `font` shorthand: what follows its size (and line height). */
function shorthand(value: string) {
  const v = value.slice(0, maxValue)
  const size =
    /(?:^|\s)[\d.]+(?:px|r?em|%|pt|pc|vw|vh|vmin|vmax|ch|ex)(?:\s*\/\s*[^\s,"']+)?\s+/i.exec(
      v
    )
  return size ? v.slice(size.index + size[0].length) : ''
}

/** What a selector list sets: headings (`h1`, `.h2`, `.section-heading`), the body (`html`, `body`, `:root`). */
function selectorRoles(prelude: string): Role[] {
  const roles = new Set<Role>()
  for (const selector of split(prelude, ',').slice(0, 50)) {
    const parts = selector.trim().split(/[\s>+~]+/)
    const last = parts[parts.length - 1] ?? ''
    const tag = /^[a-z][a-z0-9]*/i.exec(last)?.[0].toLowerCase()
    if (last === ':root' || tag === 'html' || tag === 'body') roles.add('body')
    else if (words(last).some((w) => headingWords.has(w))) roles.add('heading')
  }
  return [...roles]
}

/** A custom property naming a font family: its role (null: none), or undefined when it names none. */
function propRole(name: string): Role | null | undefined {
  const w = words(name)
  const font = w.some((x) => ['font', 'family', 'typeface', 'ff'].includes(x))
  // `type` alone names a font only beside a role (`--typeHeaderPrimary`).
  if ((!font && !w.includes('type')) || w.some((x) => notFamily.has(x))) return
  if (w.some((x) => headingWords.has(x) || x === 'header' || x === 'display'))
    return 'heading'
  if (w.some((x) => bodyWords.has(x))) return 'body'
  return font ? null : undefined
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

function readFace(body: string, base: string): FontFace | null {
  const d = new Map(declarations(body))
  const family = familyName(d.get('font-family') ?? '')
  if (!family) return null
  const [weight, maxWeight] = (d.get('font-weight') ?? '')
    .slice(0, 100)
    .toLowerCase()
    .split(/\s+/)
    .map((p) => (p === 'bold' ? 700 : p === 'normal' ? 400 : Number(p)))
    .filter((n) => n >= 1 && n <= 1000)
    .map((n) => Math.min(900, Math.max(100, Math.round(n))))
  const italic = /^(?:italic|oblique)\b/i.test(d.get('font-style') ?? '')
  const entries = split(d.get('src') ?? '', ',').map((e) => e.trim())
  const files = entries
    .slice(0, 20)
    .map((e) => fontFile(e, base))
    .filter((f) => f !== null)
    .slice(0, 4)
    .map((f) => ({
      ...f,
      weight: weight ?? 400,
      ...(maxWeight! > weight! ? { maxWeight } : {}),
      italic
    }))
    .sort((a, b) => formats.indexOf(a.format) - formats.indexOf(b.format))
  return { family, files, local: entries.some((e) => /^local\s*\(/i.test(e)) }
}

type Found = {
  usages: { role: Role | null; value: string }[]
  props: Map<string, string>
  faces: FontFace[]
  links: [string | null, string][]
}

/** What a rule's or a style attribute's declarations say about fonts. */
function fontDeclarations(body: string, roles: readonly Role[], f: Found) {
  const note = (role: Role | null, value: string) => {
    if (f.usages.length < maxFound) f.usages.push({ role, value })
  }
  for (const [name, value] of declarations(body)) {
    if (name.startsWith('--')) {
      if (f.props.size < maxFound && !f.props.has(name))
        f.props.set(name, value.slice(0, maxValue))
      const role = propRole(name)
      if (role !== undefined) note(role, value)
    } else if (name === 'font-family' || name === 'font')
      for (const role of roles)
        note(role, name === 'font' ? shorthand(value) : value)
  }
}

function readCss(css: string, base: string, f: Found) {
  scanCss(
    css,
    (prelude, body) => {
      const face = prelude.toLowerCase() === '@font-face'
      if (!face) fontDeclarations(body, selectorRoles(prelude), f)
      else if (f.faces.length < maxFound) {
        const read = readFace(body, base)
        if (read) f.faces.push(read)
      }
    },
    (statement) => {
      const at = /^\s*@import\s+(?:url\(\s*)?["']?([^"')\s]+)/i.exec(
        statement.slice(0, maxFontUrl + 100)
      )
      if (at) f.links.push([at[1]!, base])
    }
  )
}

const found = (): Found => ({
  usages: [],
  props: new Map(),
  faces: [],
  links: []
})

/**
 * The brand's fonts on one page, heading fonts first, then body fonts,
 * then fonts it only loads, each with its kind and files: from the page's
 * own `<style>` blocks and `style` attributes, its Google Fonts links, and
 * the `sheets` passed back (part b fetches `stylesheets`). Never keyword
 * or system families (Arial, `-apple-system`), icon fonts, `data:` files,
 * or files that are not WOFF2, WOFF, TTF or OTF over https on a public
 * host. Stylesheets listed: Google's, Adobe's, known font CDNs', and the
 * brand's own host's (and its store platform's).
 */
export function siteFonts(
  html: string,
  page: string,
  { sheets = [] }: { sheets?: readonly { url: string; css: string }[] } = {}
): SiteFonts {
  try {
    return read(html, page, sheets)
  } catch {
    return { families: [], stylesheets: [] }
  }
}

function read(
  html: string,
  page: string,
  sheets: readonly { url: string; css: string }[]
): SiteFonts {
  const own = siteHosts(new URL(page).hostname)
  const f = found()
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
      fontDeclarations(short(c, 'style') ?? '', [role], f)
    const kids = children(c)
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
  }
  for (const sheet of sheets.slice(0, maxStylesheets))
    readCss(sheet.css, sheet.url, f)

  const google: string[] = []
  const listed = new Map<string, FontStylesheet['from']>()
  for (const [href, base] of f.links.slice(0, maxFound)) {
    const u = publicHttps(absolute(href?.slice(0, maxFontUrl) ?? null, base))
    if (!u || listed.size >= maxStylesheets) continue
    const host = u.hostname
    if (host === 'fonts.googleapis.com' && /^\/css2?$/.test(u.pathname)) {
      const named = u.searchParams
        .getAll('family')
        .slice(0, 10)
        .flatMap((v) => v.split('|').slice(0, 10))
        .map((v) => familyName(v.split(':')[0]!))
        .filter((n) => n !== null)
      google.push(...named)
      if (named.length) listed.set(u.href, 'google')
    } else if (host === 'use.typekit.net') {
      if (/^\/[a-z0-9]{1,20}\.css$/i.test(u.pathname))
        listed.set(u.href, 'adobe')
    } else if (fontCdns.has(host)) listed.set(u.href, 'cdn')
    else if (own.has(host) || host === 'cdn.shopify.com')
      listed.set(u.href, 'site')
  }

  type Entry = Pick<SiteFont, 'family' | 'files'> &
    Record<'first' | Role, number> & { local: boolean; google: boolean }
  const byKey = new Map<string, Entry>()
  const entry = (family: string) => {
    const key = family.toLowerCase()
    const e = byKey.get(key) ?? {
      family,
      files: [],
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
    for (const file of face.files)
      if (
        e.files.length < maxFontFiles &&
        !e.files.some((x) => x.url === file.url)
      )
        e.files.push(file)
  }
  for (const name of google) entry(name).google = true

  // Heading fonts first, then body fonts, then the rest, each as found.
  const rank = (e: Entry) => Math.min(e.heading, 1e6 + e.body, 2e6 + e.first)
  const families = [...byKey.values()]
    // A font on most devices counts only when the brand serves its own file.
    .filter((e) => e.files.length || !installed.has(e.family.toLowerCase()))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, maxFamilies)
    .map((e) => ({
      family: e.family,
      roles: (['heading', 'body'] as const).filter((r) => e[r] < Infinity),
      kind: e.files[0]
        ? (fileHosts[new URL(e.files[0].url).hostname] ?? 'self-hosted')
        : e.google
          ? 'google'
          : e.local
            ? 'system'
            : 'unknown',
      files: e.files
    }))
  return {
    families,
    stylesheets: [...listed].map(([url, from]) => ({ url, from }))
  }
}
