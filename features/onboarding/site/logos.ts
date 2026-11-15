import { inflateSync } from 'node:zlib'
import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'

/**
 * Light and dark logos (owner pick #60, ONB-060a): the logo candidates on
 * the brand's own pages, each one's ink read from its own pixels (PNG and
 * SVG) or its name, and the pick of one logo for light sections and one
 * for dark sections. Pure: the Site reader fetches the pages and pictures
 * (ONB-060b keeps the pick).
 */

export type LogoCandidate = {
  /** Absolute https. */
  url: string
  /** What its name or label says about its ink, when it says. */
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
/** Largest picture read (bytes) and decoded (pixels). */
export const maxLogoBytes = 1_000_000
export const maxLogoPixels = 4_000_000

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

const lightWords = new Set([
  'white',
  'light',
  'inverse',
  'inverted',
  'reverse',
  'reversed',
  'negative',
  'knockout'
])
const darkWords = new Set(['black', 'dark'])

/** What a logo's file name or label says about its ink. */
export function inkHint(...texts: (string | null)[]): LogoCandidate['hint'] {
  const words = texts
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
  if (words.some((w) => lightWords.has(w))) return 'light'
  if (words.some((w) => darkWords.has(w))) return 'dark'
  return null
}

const named = (...texts: (string | null)[]) =>
  texts.some((t) => t !== null && /logo/i.test(t))

/** An absolute https link from a page's own words, or null. */
function absolute(src: string | null, page: string) {
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

/** The first picture of a `srcset`. */
const firstOfSet = (set: string | null) =>
  set?.split(',')[0]?.trim().split(/\s+/)[0] ?? null

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
  if (brandLike) {
    const logo = o.logo
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

/** The logo candidates on a page, surest first, each once. */
export function logoCandidates(html: string, page: string): LogoCandidate[] {
  const doc = parse(html.slice(0, 2_000_000))
  const found: LogoCandidate[] = []
  const add = (
    src: string | null,
    from: LogoCandidate['from'],
    ...labels: (string | null)[]
  ) => {
    const url = absolute(src, page)
    if (url)
      found.push({ url, hint: inkHint(new URL(url).pathname, ...labels), from })
  }
  const walk = (n: Node, inHeader: boolean, near: string[]) => {
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
        for (const u of urls) add(u, 'schema')
        continue
      }
      const itemprop = (attr(c, 'itemprop') ?? '').toLowerCase()
      if (tag === 'meta') {
        const property = (attr(c, 'property') ?? '').toLowerCase()
        if (property === 'og:logo' || itemprop === 'logo')
          add(attr(c, 'content'), 'meta')
        continue
      }
      if (tag === 'link' && itemprop === 'logo') {
        add(attr(c, 'href'), 'meta')
        continue
      }
      const label = [attr(c, 'class'), attr(c, 'id'), attr(c, 'aria-label')]
      if (tag === 'img' || tag === 'source') {
        const src =
          attr(c, 'src') ??
          attr(c, 'data-src') ??
          firstOfSet(attr(c, 'srcset') ?? attr(c, 'data-srcset'))
        const alt = attr(c, 'alt')
        if (itemprop === 'logo') add(src, 'schema', alt, ...label, ...near)
        else if (named(src, alt, ...label, ...near))
          add(src, inHeader ? 'header' : 'named', alt, ...label, ...near)
        continue
      }
      // A logo is often the picture inside a link or box named "logo".
      const own = label.filter((l): l is string => l !== null)
      walk(
        c,
        inHeader || tag === 'header' || tag === 'nav',
        [...own, ...near].slice(0, 6)
      )
    }
  }
  walk(doc, false, [])
  const best = new Map<string, LogoCandidate>()
  for (const f of found) {
    const was = best.get(f.url)
    if (!was || rank[f.from] < rank[was.from])
      best.set(f.url, { ...f, hint: f.hint ?? was?.hint ?? null })
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
  const head = new TextDecoder().decode(bytes.subarray(0, 4096)).toLowerCase()
  if (head.includes('<svg')) return svgTone(new TextDecoder().decode(bytes))
  return unknown
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

/** The pixels of a PNG (8-bit RGBA), or null when it cannot be read. */
export function decodePng(
  bytes: Uint8Array
): { width: number; height: number; rgba: Uint8Array } | null {
  if (!isPng(bytes)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  let width = 0
  let height = 0
  let depth = 0
  let type = -1
  let interlace = 0
  let palette: Uint8Array | null = null
  let alphas: Uint8Array | null = null
  const data: Uint8Array[] = []
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at)
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (body.length !== length) return null
    if (name === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      depth = body[8]!
      type = body[9]!
      interlace = body[12]!
    } else if (name === 'PLTE') palette = body
    else if (name === 'tRNS') alphas = body
    else if (name === 'IDAT') data.push(body)
    else if (name === 'IEND') break
    at += 12 + length
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]
  if (
    !channels ||
    !width ||
    !height ||
    width * height > maxLogoPixels ||
    interlace !== 0 ||
    ![1, 2, 4, 8, 16].includes(depth) ||
    (depth < 8 && type !== 0 && type !== 3) ||
    (type === 3 && (!palette || depth === 16))
  )
    return null
  const rowBytes = Math.ceil((width * channels * depth) / 8)
  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(data), {
      maxOutputLength: height * (rowBytes + 1)
    })
  } catch {
    return null
  }
  if (raw.length < height * (rowBytes + 1)) return null
  const bpp = Math.max(1, (channels * depth) / 8)
  const rows: Uint8Array[] = []
  let prev = new Uint8Array(rowBytes)
  for (let y = 0; y < height; y++) {
    const start = y * (rowBytes + 1)
    const filter = raw[start]!
    const row = Uint8Array.from(raw.subarray(start + 1, start + 1 + rowBytes))
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= bpp ? row[i - bpp]! : 0
      const up = prev[i]!
      const corner = i >= bpp ? prev[i - bpp]! : 0
      const add =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : filter === 4
                  ? paeth(left, up, corner)
                  : -1
      if (add < 0) return null
      row[i] = (row[i]! + add) & 0xff
    }
    rows.push(row)
    prev = row
  }
  const rgba = new Uint8Array(width * height * 4)
  const sample = (row: Uint8Array, index: number) => {
    if (depth === 8) return row[index]!
    if (depth === 16) return row[index * 2]!
    const bit = index * depth
    const byte = row[bit >> 3]!
    return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
  }
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1
  const same16 = (row: Uint8Array, index: number, want: number) =>
    depth === 16
      ? row[index * 2]! * 256 + row[index * 2 + 1]! === want
      : sample(row, index) === want
  for (let y = 0; y < height; y++) {
    const row = rows[y]!
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
        const v = sample(row, x * channels) * scale
        r = g = b = v
        if (type === 4) a = sample(row, x * channels + 1)
        else if (alphas && alphas.length >= 2) {
          // The one grey that is see-through.
          if (same16(row, x, (alphas[0]! << 8) | alphas[1]!)) a = 0
        }
      } else {
        r = sample(row, x * channels)
        g = sample(row, x * channels + 1)
        b = sample(row, x * channels + 2)
        if (type === 6) a = sample(row, x * channels + 3)
        else if (alphas && alphas.length >= 6) {
          const key = (i: number) =>
            (alphas![i * 2]! << 8) | alphas![i * 2 + 1]!
          const same = (c: number, k: number) =>
            depth === 16
              ? row[(x * channels + c) * 2]! * 256 +
                  row[(x * channels + c) * 2 + 1]! ===
                k
              : sample(row, x * channels + c) === k
          if (same(0, key(0)) && same(1, key(1)) && same(2, key(2))) a = 0
        }
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
  const total = width * height
  const step = Math.max(1, Math.floor(total / 100_000))
  let opaque = 0
  let counted = 0
  let sum = 0
  for (let p = 0; p < total; p += step) {
    counted++
    const o = p * 4
    if (rgba[o + 3]! < seen) continue
    opaque++
    sum += luminance(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!)
  }
  if (!opaque) return unknown
  // Hardly any transparency: the logo carries its own background, and the
  // box is what meets the section (its corners say its colour).
  if (opaque / counted > 0.95) {
    const corners = [0, width - 1, (height - 1) * width, total - 1].map((p) =>
      luminance(rgba[p * 4]!, rgba[p * 4 + 1]!, rgba[p * 4 + 2]!)
    )
    const box = corners.reduce((a, b) => a + b, 0) / corners.length
    return { tone: box >= lightInk ? 'dark' : 'light', boxed: true }
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
  const text = svg.slice(0, maxLogoBytes)
  const values: string[] = []
  for (const m of text.matchAll(
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
 * ink), never the same picture. A measured ink wins over a name's; with
 * nothing known, the surest candidate is taken for light sections (a
 * site's own header logo), and dark sections get none rather than a guess.
 */
export function pickLogos(
  found: readonly { candidate: LogoCandidate; tone: LogoTone | null }[]
): { onLight: string | null; onDark: string | null } {
  const ink = (f: (typeof found)[number]) =>
    f.tone && f.tone.tone !== 'unknown'
      ? f.tone.tone
      : (f.candidate.hint ?? 'unknown')
  const onLight =
    found.find((f) => ink(f) === 'dark' && !f.tone?.boxed) ??
    found.find((f) => ink(f) === 'dark') ??
    found.find((f) => ink(f) === 'unknown' && f.candidate.from !== 'meta')
  const onDark = found.find(
    (f) => ink(f) === 'light' && f.candidate.url !== onLight?.candidate.url
  )
  return {
    onLight: onLight?.candidate.url ?? null,
    onDark: onDark?.candidate.url ?? null
  }
}
