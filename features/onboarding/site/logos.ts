import { inflateSync } from 'node:zlib'
import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'

/**
 * Light and dark logos (owner pick #60, ONB-060a): the logo candidates on
 * the brand's own pages, each one's ink read from its own pixels (PNG and
 * SVG) or its own name, and the pick of one logo for light sections and
 * one for dark sections. Pure: the Site reader fetches the pages and
 * pictures (ONB-060b keeps the pick). Every picture is untrusted bytes:
 * a bad one is "unknown", never an error.
 */

export type LogoCandidate = {
  /** Absolute https. */
  url: string
  /** What its own file name or label says about its ink, when it says. */
  hint: 'light' | 'dark' | null
  /** Where it was found, surest first: structured data, the header, a named image, a tag. */
  from: 'schema' | 'header' | 'named' | 'meta'
}

export type LogoTone = {
  /** Its ink: dark ink reads on light sections, light ink on dark ones. */
  tone: 'dark' | 'light' | 'unknown'
  /** It carries its own background (no transparency): then `tone` is the box's. */
  boxed: boolean
}

/** Most candidates kept per page. */
export const maxCandidates = 6
/** Largest picture read (bytes), decoded (pixels) and on any side. */
export const maxLogoBytes = 1_000_000
export const maxLogoPixels = 2_000_000
export const maxLogoSide = 4_096

type Node = T.ChildNode | T.ParentNode
const isElement = (n: Node): n is T.Element => 'tagName' in n
const attr = (n: T.Element, name: string) =>
  n.attrs.find((a) => a.name === name)?.value ?? null
const children = (n: Node): T.ChildNode[] =>
  'childNodes' in n ? n.childNodes : []
const textOf = (n: Node): string =>
  n.nodeName === '#text'
    ? (n as T.TextNode).value
    : children(n).map(textOf).join('')

/** The words of names and labels: `siteLogo-white@2x.png` is site, logo, white, 2x, png. */
export const words = (...texts: (string | null)[]) =>
  texts
    .filter((t): t is string => t !== null)
    .join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

// Only words that say the ink: "light" and "dark" may name a light or
// dark mode instead (a "logo-dark" is often the white logo for dark mode).
const lightWords = new Set([
  'white',
  'inverse',
  'inverted',
  'reverse',
  'reversed',
  'negative',
  'knockout'
])
const darkWords = new Set(['black'])
/** Boxes whose pictures are other brands' logos or icons, never the brand's. */
const otherBrands: ReadonlySet<string> = new Set([
  'press',
  'partner',
  'partners',
  'featured',
  'seen',
  'client',
  'clients',
  'brands',
  'sponsor',
  'sponsors',
  'trust',
  'badges',
  'payment',
  'payments',
  'logos',
  'awards',
  'retailers',
  'stockists',
  'social'
])

/** The page's own parts: their words never mark a box of other brands. */
export const landmarks: ReadonlySet<string> = new Set([
  'html',
  'body',
  'header',
  'nav',
  'main',
  'footer'
])

/**
 * What a logo's own file name or label says about its ink. `brand` words
 * (the brand's name, its web address) never count: "White Fox" is a name.
 */
export function inkHint(
  texts: readonly (string | null)[],
  brand: ReadonlySet<string> = new Set()
): LogoCandidate['hint'] {
  const w = words(...texts).filter((x) => !brand.has(x))
  if (w.some((x) => lightWords.has(x))) return 'light'
  if (w.some((x) => darkWords.has(x))) return 'dark'
  return null
}

/** Named "logo" as a word (not "logout", not a box of "logos"). */
const namedLogo = (...texts: (string | null)[]) =>
  words(...texts).includes('logo')

/** An absolute https link from a page's own words, or null. */
export function absolute(src: string | null, page: string) {
  const s = src?.trim()
  if (!s || s.startsWith('data:')) return null
  try {
    const url = new URL(s, page)
    if (url.protocol === 'http:' && new URL(page).protocol === 'https:')
      url.protocol = 'https:'
    if (url.protocol !== 'https:') return null
    if (/\.ico$/i.test(url.pathname)) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

/** The largest picture of a `srcset` (entries end at a comma and a space). */
export function largestOfSet(set: string | null) {
  if (!set) return null
  let best: { url: string; size: number } | null = null
  for (const entry of set.split(/,\s+/)) {
    const [url, descriptor = '1x'] = entry.trim().split(/\s+/)
    if (!url) continue
    const size = parseFloat(descriptor) * (descriptor.endsWith('w') ? 1 : 1000)
    if (!best || (Number.isFinite(size) && size > best.size))
      best = { url, size: Number.isFinite(size) ? size : 0 }
  }
  return best?.url ?? null
}

/** Logos named in structured data (`Organization`, `Brand`, a store). */
function schemaLogos(json: unknown, out: string[]) {
  if (Array.isArray(json)) {
    for (const item of json) schemaLogos(item, out)
    return
  }
  if (!json || typeof json !== 'object') return
  const o = json as Record<string, unknown>
  if ('@graph' in o) schemaLogos(o['@graph'], out)
  const types = ([] as unknown[]).concat(o['@type'] ?? [])
  const brandLike = types.some(
    (t) =>
      typeof t === 'string' &&
      /^(Organization|Corporation|Brand|Store|OnlineStore|OnlineBusiness|LocalBusiness)$/.test(
        t
      )
  )
  if (!brandLike) return
  for (const logo of ([] as unknown[]).concat(o.logo ?? [])) {
    const url =
      typeof logo === 'string'
        ? logo
        : logo && typeof logo === 'object'
          ? ((logo as Record<string, unknown>).url ??
            (logo as Record<string, unknown>).contentUrl)
          : null
    if (typeof url === 'string') out.push(url)
  }
}

const rank: Record<LogoCandidate['from'], number> = {
  schema: 0,
  header: 1,
  named: 2,
  meta: 3
}

/** Where the walk is: in the header, in a home link, in a box of other brands' logos. */
type Place = { header: boolean; homeLink: boolean; others: boolean }

/** The logo candidates on a page, surest first, each once. */
export function logoCandidates(
  html: string,
  page: string,
  { brand = '' }: { brand?: string } = {}
): LogoCandidate[] {
  let origin: string
  let host: string
  try {
    ;({ origin, hostname: host } = new URL(page))
  } catch {
    return []
  }
  const doc = parse(html.slice(0, 2_000_000))
  const brandWords = new Set(words(brand, host))
  const locale =
    /^\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i
      .exec(new URL(page).pathname)?.[1]
      ?.toLowerCase() ?? null
  const found: LogoCandidate[] = []
  const add = (
    url: string | null,
    from: LogoCandidate['from'],
    ...own: (string | null)[]
  ) => {
    if (url)
      found.push({
        url,
        hint: inkHint([new URL(url).pathname, ...own], brandWords),
        from
      })
  }
  /** The first of a picture's sources that is a usable link (a lazy picture's placeholder is not). */
  const sourceOf = (c: T.Element) => {
    for (const s of [
      attr(c, 'src'),
      attr(c, 'data-src'),
      attr(c, 'data-lazy-src'),
      attr(c, 'data-original'),
      largestOfSet(attr(c, 'srcset')),
      largestOfSet(attr(c, 'data-srcset'))
    ]) {
      const url = absolute(s, page)
      if (url) return url
    }
    return null
  }
  const isHome = (href: string | null) => {
    if (!href) return false
    try {
      const u = new URL(href, page)
      if (u.origin !== origin) return false
      const path = u.pathname.toLowerCase().replace(/\/+$/, '')
      // The home page, or the home of the page's own locale (`/en-gb` on
      // an `/en-gb/…` page): never another language's (a flag is no logo).
      return path === '' || (locale !== null && path === `/${locale}`)
    } catch {
      return false
    }
  }
  const walk = (n: Node, at: Place) => {
    for (const c of children(n)) {
      if (!isElement(c)) continue
      const tag = c.tagName
      if (
        tag === 'script' &&
        (attr(c, 'type') ?? '').toLowerCase() === 'application/ld+json'
      ) {
        const urls: string[] = []
        try {
          schemaLogos(JSON.parse(textOf(c).slice(0, 200_000)), urls)
        } catch {
          // Not readable structured data: other candidates still count.
        }
        for (const u of urls) add(absolute(u, page), 'schema')
        continue
      }
      const itemprop = (attr(c, 'itemprop') ?? '').toLowerCase()
      if (tag === 'meta') {
        const property = (attr(c, 'property') ?? '').toLowerCase()
        if (property === 'og:logo' || itemprop === 'logo')
          add(absolute(attr(c, 'content'), page), 'meta')
        continue
      }
      if (tag === 'link' && itemprop === 'logo') {
        add(absolute(attr(c, 'href'), page), 'meta')
        continue
      }
      const label = [attr(c, 'class'), attr(c, 'id'), attr(c, 'aria-label')]
      if (tag === 'img' || tag === 'source') {
        if (at.others) continue
        const src = sourceOf(c)
        const own = [attr(c, 'alt'), ...label]
        if (itemprop === 'logo') add(src, 'schema', ...own)
        // Its own name says logo, or it is the picture of the home link
        // in the header (the classic logo).
        else if (
          namedLogo(src && new URL(src).pathname, ...own) ||
          (at.header && at.homeLink)
        )
          add(src, at.header ? 'header' : 'named', ...own)
        continue
      }
      walk(c, {
        header: at.header || tag === 'header' || tag === 'nav',
        homeLink: at.homeLink || (tag === 'a' && isHome(attr(c, 'href'))),
        // A landmark's own words ("site-header--social") never hide the
        // brand's logo: only a box inside one.
        others:
          at.others ||
          (!landmarks.has(tag) &&
            words(...label).some((w) => otherBrands.has(w)))
      })
    }
  }
  walk(doc, { header: false, homeLink: false, others: false })
  const best = new Map<string, LogoCandidate>()
  for (const f of found) {
    const was = best.get(f.url)
    if (!was) best.set(f.url, f)
    else
      best.set(
        f.url,
        rank[f.from] < rank[was.from]
          ? { ...f, hint: f.hint ?? was.hint }
          : { ...was, hint: was.hint ?? f.hint }
      )
  }
  return [...best.values()]
    .sort((a, b) => rank[a.from] - rank[b.from])
    .slice(0, maxCandidates)
}

/** Relative luminance (sRGB), 0 to 1. */
function luminance(r: number, g: number, b: number) {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Ink this light or lighter reads only on dark sections. */
const lightInk = 0.6

const unknown: LogoTone = { tone: 'unknown', boxed: false }

/** A logo's ink from its own bytes: PNG and SVG are read; other formats are unknown. */
export function logoTone(bytes: Uint8Array): LogoTone {
  if (bytes.length === 0 || bytes.length > maxLogoBytes) return unknown
  if (isPng(bytes)) return pngTone(bytes) ?? unknown
  if (bytes[0] === 0xff && bytes[1] === 0xd8)
    // A JPEG has no transparency: its background is part of it.
    return { tone: 'unknown', boxed: true }
  const text = new TextDecoder().decode(bytes)
  // Only a file that is an SVG (a page with an icon in it is not).
  return startsAsSvg(text) ? svgTone(text) : unknown
}

/**
 * Whether a text starts as an SVG: `<svg` after only an XML line,
 * comments and a doctype. Scanned left to right, never a pattern that
 * could take long on a hostile file.
 */
function startsAsSvg(text: string) {
  const lower = text.slice(0, 8_000).toLowerCase()
  let i = 0
  for (;;) {
    while (i < lower.length && /\s/.test(lower[i]!)) i++
    const skip = (open: string, close: string) => {
      if (!lower.startsWith(open, i)) return false
      const end = lower.indexOf(close, i + open.length)
      i = end < 0 ? lower.length : end + close.length
      return true
    }
    if (skip('<?xml', '?>') || skip('<!--', '-->') || skip('<!doctype', '>'))
      continue
    return /^<svg[\s>]/.test(lower.slice(i, i + 5))
  }
}

/**
 * An SVG, in lowercase (its colours are read so), without its clip and
 * mask shapes (they only cut what is drawn). One pass left to right: each
 * tag's next match is remembered, so no text is searched twice. An
 * unclosed one ends the drawing there.
 */
function withoutClips(svg: string) {
  const s = svg.toLowerCase()
  type Tag = '<clippath' | '<mask'
  const ahead: Record<Tag, number> = {
    '<clippath': -1,
    '<mask': -1
  }
  /** The next whole `tag` at or after `from` (not `<masking`), or Infinity. */
  const nextOf = (tag: Tag, from: number) => {
    if (ahead[tag] >= from) return ahead[tag]
    let at = s.indexOf(tag, from)
    while (at >= 0 && !/[\s>/]/.test(s[at + tag.length] ?? '>'))
      at = s.indexOf(tag, at + 1)
    ahead[tag] = at < 0 ? Infinity : at
    return ahead[tag]
  }
  let out = ''
  let i = 0
  while (i < s.length) {
    const clip = nextOf('<clippath', i)
    const mask = nextOf('<mask', i)
    const open = Math.min(clip, mask)
    if (open === Infinity) return out + s.slice(i)
    out += s.slice(i, open)
    const tag = open === clip ? 'clippath' : 'mask'
    const head = s.indexOf('>', open)
    if (head < 0) return out
    // `<mask … />` closes itself.
    if (s[head - 1] === '/') {
      i = head + 1
      continue
    }
    const close = s.indexOf(`</${tag}`, head)
    if (close < 0) return out
    const end = s.indexOf('>', close)
    i = end < 0 ? s.length : end + 1
  }
  return out
}

const isPng = (b: Uint8Array) =>
  b.length > 8 &&
  b[0] === 0x89 &&
  b[1] === 0x50 &&
  b[2] === 0x4e &&
  b[3] === 0x47 &&
  b[4] === 0x0d &&
  b[5] === 0x0a &&
  b[6] === 0x1a &&
  b[7] === 0x0a

/**
 * The pixels of a PNG (8-bit RGBA), or null when it cannot be read: a
 * broken or short header, an interlaced or unknown kind, more than
 * `maxLogoSide` on a side or `maxLogoPixels` in all. Unfiltered in place,
 * so its memory is the inflated data and the pixels, nothing per row.
 */
export function decodePng(
  bytes: Uint8Array
): { width: number; height: number; rgba: Uint8Array } | null {
  if (!isPng(bytes)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  let header: Uint8Array | null = null
  let palette: Uint8Array | null = null
  let alphas: Uint8Array | null = null
  const data: Uint8Array[] = []
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at)
    if (length > bytes.length) return null
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (body.length !== length) return null
    if (name === 'IHDR') header = body
    else if (name === 'PLTE') palette = body
    else if (name === 'tRNS') alphas = body
    else if (name === 'IDAT') data.push(body)
    else if (name === 'IEND') break
    at += 12 + length
  }
  if (!header || header.length < 13 || !data.length) return null
  const h = new DataView(header.buffer, header.byteOffset, header.byteLength)
  const width = h.getUint32(0)
  const height = h.getUint32(4)
  const depth = header[8]!
  const type = header[9]!
  const interlace = header[12]!
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[
    type
  ]
  if (
    !channels ||
    !width ||
    !height ||
    width > maxLogoSide ||
    height > maxLogoSide ||
    width * height > maxLogoPixels ||
    interlace !== 0 ||
    ![1, 2, 4, 8, 16].includes(depth) ||
    (depth < 8 && type !== 0 && type !== 3) ||
    (type === 3 && (!palette || depth === 16))
  )
    return null
  const rowBytes = Math.ceil((width * channels * depth) / 8)
  const stride = rowBytes + 1
  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(data), {
      maxOutputLength: height * stride
    })
  } catch {
    return null
  }
  if (raw.length < height * stride) return null
  const bpp = Math.max(1, (channels * depth) / 8)
  // Unfiltered in place: each row's filter byte stays, its bytes become pixels.
  for (let y = 0; y < height; y++) {
    const row = y * stride + 1
    const up = row - stride
    const filter = raw[row - 1]!
    if (filter > 4) return null
    if (filter === 0) continue
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= bpp ? raw[row + i - bpp]! : 0
      const above = y > 0 ? raw[up + i]! : 0
      const corner = y > 0 && i >= bpp ? raw[up + i - bpp]! : 0
      const add =
        filter === 1
          ? left
          : filter === 2
            ? above
            : filter === 3
              ? (left + above) >> 1
              : paeth(left, above, corner)
      raw[row + i] = (raw[row + i]! + add) & 0xff
    }
  }
  const sample = (row: number, index: number) => {
    if (depth === 8) return raw[row + index]!
    if (depth === 16) return raw[row + index * 2]!
    const bit = index * depth
    return (
      (raw[row + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
    )
  }
  /** A sample at full precision, to compare with a tRNS colour. */
  const exact = (row: number, index: number) =>
    depth === 16
      ? raw[row + index * 2]! * 256 + raw[row + index * 2 + 1]!
      : sample(row, index)
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1
  const key = (i: number) =>
    alphas && alphas.length >= i * 2 + 2
      ? (alphas[i * 2]! << 8) | alphas[i * 2 + 1]!
      : -1
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = y * stride + 1
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      let r: number, g: number, b: number
      let a = 255
      if (type === 3) {
        const i = sample(row, x)
        r = palette![i * 3] ?? 0
        g = palette![i * 3 + 1] ?? 0
        b = palette![i * 3 + 2] ?? 0
        a = alphas && i < alphas.length ? alphas[i]! : 255
      } else if (type === 0 || type === 4) {
        r = g = b = sample(row, x * channels) * scale
        if (type === 4) a = sample(row, x * channels + 1)
        // The one grey that is see-through.
        else if (exact(row, x) === key(0)) a = 0
      } else {
        r = sample(row, x * channels)
        g = sample(row, x * channels + 1)
        b = sample(row, x * channels + 2)
        if (type === 6) a = sample(row, x * channels + 3)
        else if (
          exact(row, x * 3) === key(0) &&
          exact(row, x * 3 + 1) === key(1) &&
          exact(row, x * 3 + 2) === key(2)
        )
          a = 0
      }
      rgba[o] = r
      rgba[o + 1] = g
      rgba[o + 2] = b
      rgba[o + 3] = a
    }
  }
  return { width, height, rgba }
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Opaque enough to be seen. */
const seen = 128

function pngTone(bytes: Uint8Array): LogoTone | null {
  const png = decodePng(bytes)
  if (!png) return null
  const { width, height, rgba } = png
  const lum = (p: number) =>
    luminance(rgba[p * 4]!, rgba[p * 4 + 1]!, rgba[p * 4 + 2]!)
  // A grid of at most about 100,000 pixels, every row and column alike.
  const stepX = Math.max(1, Math.ceil(width / 316))
  const stepY = Math.max(1, Math.ceil(height / 316))
  let opaque = 0
  let counted = 0
  let sum = 0
  for (let y = 0; y < height; y += stepY)
    for (let x = 0; x < width; x += stepX) {
      counted++
      const p = y * width + x
      if (rgba[p * 4 + 3]! < seen) continue
      opaque++
      sum += lum(p)
    }
  if (!opaque) return unknown
  // Hardly any transparency: the logo carries its own background, and the
  // box is what meets the section. Its colour is its visible edge (rounded
  // see-through corners do not count).
  if (opaque / counted > 0.95) {
    let edge = 0
    let edges = 0
    const look = (x: number, y: number) => {
      const p = y * width + x
      if (rgba[p * 4 + 3]! < seen) return
      edge += lum(p)
      edges++
    }
    for (let x = 0; x < width; x += stepX) {
      look(x, 0)
      look(x, height - 1)
    }
    for (let y = 0; y < height; y += stepY) {
      look(0, y)
      look(width - 1, y)
    }
    if (!edges) return unknown
    return { tone: edge / edges >= lightInk ? 'dark' : 'light', boxed: true }
  }
  return { tone: sum / opaque >= lightInk ? 'light' : 'dark', boxed: false }
}

const namedColours: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0]
}

/** An SVG colour as RGB, or null (none, transparent, currentColor, a gradient). */
function colour(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase()
  if (namedColours[v]) return namedColours[v]
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)
  if (hex) {
    const h =
      hex[1]!.length === 3
        ? hex[1]!
            .split('')
            .map((c) => c + c)
            .join('')
        : hex[1]!
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
      number,
      number,
      number
    ]
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/.exec(
    v
  )
  if (rgb)
    return [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n))) as [
      number,
      number,
      number
    ]
  return null
}

function svgTone(svg: string): LogoTone {
  // What is drawn: not the shapes that only clip or mask it.
  const drawn = withoutClips(svg.slice(0, maxLogoBytes))
  const shapes = /<(?:path|rect|circle|ellipse|polygon|polyline|line|text)\b/i
  // A picture inside an SVG: its ink is not in the SVG.
  if (/<image\b/i.test(drawn) && !shapes.test(drawn)) return unknown
  const values: string[] = []
  for (const m of drawn.matchAll(
    /\b(?:fill|stroke|stop-color)\s*(?:=\s*["']([^"']+)["']|:\s*([^;"'}]+))/gi
  ))
    values.push((m[1] ?? m[2] ?? '').trim())
  const colours = values
    .map(colour)
    .filter((c): c is [number, number, number] => c !== null)
  const painted = values.filter((v) => !/^(none|transparent)$/i.test(v))
  // No colour named: SVG paints black.
  if (!colours.length)
    return painted.length ? unknown : { tone: 'dark', boxed: false }
  const mean =
    colours.reduce((a, [r, g, b]) => a + luminance(r, g, b), 0) / colours.length
  return { tone: mean >= lightInk ? 'light' : 'dark', boxed: false }
}

/**
 * The logo for light sections (dark ink) and for dark sections (light
 * ink), never the same picture. A measured ink wins over a name's, and a
 * see-through logo over a boxed one. With nothing known, the surest logo
 * (not a tag's) is taken for light sections, unless every logo measured on
 * the site is light ink (then its header logo is likely light too); dark
 * sections get none rather than a guess.
 */
export function pickLogos(
  found: readonly { candidate: LogoCandidate; tone: LogoTone | null }[]
): { onLight: string | null; onDark: string | null } {
  const ink = (f: (typeof found)[number]) =>
    f.tone && f.tone.tone !== 'unknown'
      ? f.tone.tone
      : (f.candidate.hint ?? 'unknown')
  const best = (want: 'dark' | 'light', not?: string) =>
    found.find(
      (f) => ink(f) === want && !f.tone?.boxed && f.candidate.url !== not
    ) ?? found.find((f) => ink(f) === want && f.candidate.url !== not)
  const measuredLight = found.some((f) => f.tone?.tone === 'light')
  const measuredDark = found.some((f) => f.tone?.tone === 'dark')
  const onLight =
    best('dark') ??
    (measuredLight && !measuredDark
      ? undefined
      : found.find((f) => ink(f) === 'unknown' && f.candidate.from !== 'meta'))
  const onDark = best('light', onLight?.candidate.url)
  return {
    onLight: onLight?.candidate.url ?? null,
    onDark: onDark?.candidate.url ?? null
  }
}
