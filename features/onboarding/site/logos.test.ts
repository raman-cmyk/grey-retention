import { crc32, deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  decodePng,
  inkHint,
  logoCandidates,
  logoTone,
  maxCandidates,
  pickLogos,
  type LogoCandidate
} from './logos'

const page = 'https://shop.example/'

/** A PNG from rows of RGBA pixels (colour type 6), each row with `filter`. */
function png(
  rows: [number, number, number, number][][],
  { filter = 0, type = 6, extra = [] as Uint8Array[], interlace = 0 } = {}
) {
  const chunk = (name: string, body: Uint8Array) => {
    const out = Buffer.alloc(12 + body.length)
    out.writeUInt32BE(body.length, 0)
    out.write(name, 4, 'latin1')
    Buffer.from(body).copy(out, 8)
    out.writeUInt32BE(
      crc32(Buffer.concat([Buffer.from(name, 'latin1'), Buffer.from(body)])),
      8 + body.length
    )
    return out
  }
  const width = rows[0]!.length
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(rows.length, 4)
  ihdr[8] = 8
  ihdr[9] = type
  ihdr[12] = interlace
  const channels = type === 6 ? 4 : type === 2 ? 3 : 1
  const raw: number[] = []
  let prev: number[] = new Array(width * channels).fill(0)
  for (const row of rows) {
    const bytes = row.flatMap((p) =>
      type === 6 ? p : type === 2 ? p.slice(0, 3) : type === 0 ? [p[0]] : [p[0]]
    )
    raw.push(filter)
    bytes.forEach((v, i) => {
      const left = i >= channels ? bytes[i - channels]! : 0
      const up = prev[i]!
      raw.push(
        filter === 1 ? (v - left) & 0xff : filter === 2 ? (v - up) & 0xff : v
      )
    })
    prev = bytes
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      ...extra.map((e, i) => chunk(i === 0 ? 'PLTE' : 'tRNS', e)),
      chunk('IDAT', deflateSync(Buffer.from(raw))),
      chunk('IEND', new Uint8Array())
    ])
  )
}
const clear: [number, number, number, number] = [0, 0, 0, 0]
const black: [number, number, number, number] = [10, 10, 10, 255]
const white: [number, number, number, number] = [250, 250, 250, 255]
/** A 4x4 logo: ink in the middle, a see-through border. */
const inked = (ink: [number, number, number, number]) => [
  [clear, clear, clear, clear],
  [clear, ink, ink, clear],
  [clear, ink, ink, clear],
  [clear, clear, clear, clear]
]
/** A logo on its own box: `box` all round, `ink` in the middle. */
const boxed = (
  box: [number, number, number, number],
  ink: [number, number, number, number]
) => [
  [box, box, box, box],
  [box, ink, ink, box],
  [box, ink, ink, box],
  [box, box, box, box]
]
const svg = (body: string) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`
  )

describe('logoCandidates (ONB-060a)', () => {
  it('finds the logos a page names, surest first, each once, as https links', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"Linen & Co","logo":{"@type":"ImageObject","url":"/img/logo.svg"}}]}</script>
      <meta property="og:logo" content="https://cdn.example/brand/mark.png">
      <link rel="icon" href="/favicon.ico">
    </head><body>
      <header><a class="site-header__logo" href="/"><img src="http://shop.example/img/brand-black.png" alt="Linen & Co"></a></header>
      <main><img src="/img/linen-shirt.jpg" alt="A linen shirt"></main>
      <footer><img src="/img/logo-white.png" alt="Linen & Co logo"><img src="data:image/png;base64,AAAA" alt="logo"></footer>
      <img src="/img/logo.svg" alt="logo again">
    </body></html>`
    expect(logoCandidates(html, page)).toEqual([
      { url: 'https://shop.example/img/logo.svg', hint: null, from: 'schema' },
      {
        url: 'https://shop.example/img/brand-black.png',
        hint: 'dark',
        from: 'header'
      },
      {
        url: 'https://shop.example/img/logo-white.png',
        hint: 'light',
        from: 'named'
      },
      { url: 'https://cdn.example/brand/mark.png', hint: null, from: 'meta' }
    ])
  })

  it('reads lazy pictures, the logo itemprop, and keeps to its limit', () => {
    const many = Array.from(
      { length: 10 },
      (_, i) =>
        `<img class="logo" data-srcset="/l${i}.png 1x, /l${i}@2x.png 2x">`
    ).join('')
    const found = logoCandidates(
      `<div itemscope><img itemprop="logo" data-src="/brand.png"></div>${many}`,
      page
    )
    expect(found[0]).toEqual({
      url: 'https://shop.example/brand.png',
      hint: null,
      from: 'schema'
    })
    expect(found[1]!.url).toBe('https://shop.example/l0.png')
    expect(found).toHaveLength(maxCandidates)
  })

  it('finds nothing in a page without logos, or with broken structured data', () => {
    expect(
      logoCandidates(
        '<script type="application/ld+json">{not json</script><img src="/a.jpg">',
        page
      )
    ).toEqual([])
    // A plain http page's own http links are not used.
    expect(
      logoCandidates(
        '<img class="logo" src="/logo.png">',
        'http://shop.example/'
      )
    ).toEqual([])
  })

  it('reads ink words in names and labels', () => {
    expect(inkHint('/logo-reversed.png')).toBe('light')
    expect(inkHint('/LogoWhite.png')).toBeNull()
    expect(inkHint('/logo_white_2x.png')).toBe('light')
    expect(inkHint('/logo.png', 'Dark logo')).toBe('dark')
    expect(inkHint('/darkness.png')).toBeNull()
  })
})

describe('logoTone (ONB-060a)', () => {
  it('reads the ink of a see-through PNG', () => {
    expect(logoTone(png(inked(black)))).toEqual({ tone: 'dark', boxed: false })
    expect(logoTone(png(inked(white)))).toEqual({ tone: 'light', boxed: false })
    // Every filter a row may use.
    for (const filter of [1, 2])
      expect(logoTone(png(inked(white), { filter }))).toEqual({
        tone: 'light',
        boxed: false
      })
  })

  it('takes a PNG with its own background by its box', () => {
    expect(logoTone(png(boxed(white, black)))).toEqual({
      tone: 'dark',
      boxed: true
    })
    expect(logoTone(png(boxed(black, white)))).toEqual({
      tone: 'light',
      boxed: true
    })
  })

  it('reads palette and grey PNGs, with their see-through colour', () => {
    // Palette: 0 see-through, 1 white.
    const indexed = inked(white).map((row) =>
      row.map(
        (p) => [p[3] ? 1 : 0, 0, 0, 0] as [number, number, number, number]
      )
    )
    const plte = new Uint8Array([0, 0, 0, 255, 255, 255])
    const trns = new Uint8Array([0, 255])
    expect(logoTone(png(indexed, { type: 3, extra: [plte, trns] }))).toEqual({
      tone: 'light',
      boxed: false
    })
    const grey = boxed([255, 0, 0, 255], [0, 0, 0, 255])
    expect(decodePng(png(grey, { type: 0 }))?.rgba.slice(0, 4)).toEqual(
      new Uint8Array([255, 255, 255, 255])
    )
    expect(logoTone(png(grey, { type: 0 }))).toEqual({
      tone: 'dark',
      boxed: true
    })
  })

  it('reads an SVG’s colours; with none named it paints black', () => {
    expect(logoTone(svg('<path fill="#fff" d="M0 0h1v1z"/>'))).toEqual({
      tone: 'light',
      boxed: false
    })
    expect(
      logoTone(svg('<path style="fill: rgb(20, 20, 20)" d="M0 0h1v1z"/>'))
    ).toEqual({ tone: 'dark', boxed: false })
    expect(logoTone(svg('<path d="M0 0h1v1z"/>'))).toEqual({
      tone: 'dark',
      boxed: false
    })
    expect(logoTone(svg('<path fill="currentColor" d="M0 0h1v1z"/>'))).toEqual({
      tone: 'unknown',
      boxed: false
    })
  })

  it('knows nothing of other or broken pictures', () => {
    expect(logoTone(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      tone: 'unknown',
      boxed: true
    })
    expect(logoTone(new Uint8Array([1, 2, 3]))).toEqual({
      tone: 'unknown',
      boxed: false
    })
    expect(logoTone(new Uint8Array())).toEqual({
      tone: 'unknown',
      boxed: false
    })
    const broken = png(inked(black)).slice(0, 40)
    expect(logoTone(broken)).toEqual({ tone: 'unknown', boxed: false })
    expect(logoTone(png(inked(black), { interlace: 1 }))).toEqual({
      tone: 'unknown',
      boxed: false
    })
    // Nothing visible at all.
    expect(logoTone(png(inked(clear)))).toEqual({
      tone: 'unknown',
      boxed: false
    })
  })
})

describe('pickLogos (ONB-060a)', () => {
  const c = (
    url: string,
    hint: LogoCandidate['hint'] = null,
    from: LogoCandidate['from'] = 'named'
  ): LogoCandidate => ({ url, hint, from })

  it('takes dark ink for light sections and light ink for dark ones', () => {
    expect(
      pickLogos([
        { candidate: c('a'), tone: { tone: 'dark', boxed: false } },
        { candidate: c('b'), tone: { tone: 'light', boxed: false } }
      ])
    ).toEqual({ onLight: 'a', onDark: 'b' })
  })

  it('trusts the pixels over a name, and a see-through logo over a boxed one', () => {
    expect(
      pickLogos([
        // Named white, but its pixels are dark.
        { candidate: c('a', 'light'), tone: { tone: 'dark', boxed: true } },
        { candidate: c('b'), tone: { tone: 'dark', boxed: false } },
        { candidate: c('c', 'light'), tone: { tone: 'unknown', boxed: false } }
      ])
    ).toEqual({ onLight: 'b', onDark: 'c' })
  })

  it('with nothing known takes the surest logo for light sections, none for dark', () => {
    expect(
      pickLogos([
        { candidate: c('m', null, 'meta'), tone: null },
        { candidate: c('h', null, 'header'), tone: null }
      ])
    ).toEqual({ onLight: 'h', onDark: null })
    expect(pickLogos([])).toEqual({ onLight: null, onDark: null })
  })
})
