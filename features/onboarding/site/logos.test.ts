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

type Px = [number, number, number, number]

function chunk(name: string, body: Uint8Array) {
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
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ihdr = (w: number, h: number, depth: number, type: number, lace = 0) => {
  const b = Buffer.alloc(13)
  b.writeUInt32BE(w, 0)
  b.writeUInt32BE(h, 4)
  b[8] = depth
  b[9] = type
  b[12] = lace
  return b
}
function paeth(a: number, b: number, c: number) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}
/**
 * A PNG from rows of already packed bytes, each row filtered with
 * `filter` (0 none, 1 sub, 2 up, 3 average, 4 Paeth).
 */
function pngFrom(
  rows: number[][],
  {
    width,
    depth = 8,
    type = 6,
    bpp = 4,
    filter = 0,
    palette,
    trns,
    lace = 0
  }: {
    width: number
    depth?: number
    type?: number
    bpp?: number
    filter?: number
    palette?: number[]
    trns?: number[]
    lace?: number
  }
) {
  const raw: number[] = []
  let prev: number[] = new Array(rows[0]!.length).fill(0)
  for (const row of rows) {
    raw.push(filter)
    row.forEach((v, i) => {
      const left = i >= bpp ? row[i - bpp]! : 0
      const up = prev[i]!
      const corner = i >= bpp ? prev[i - bpp]! : 0
      const pred =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? (left + up) >> 1
              : filter === 4
                ? paeth(left, up, corner)
                : 0
      raw.push((v - pred) & 0xff)
    })
    prev = row
  }
  return new Uint8Array(
    Buffer.concat([
      signature,
      chunk('IHDR', ihdr(width, rows.length, depth, type, lace)),
      ...(palette ? [chunk('PLTE', new Uint8Array(palette))] : []),
      ...(trns ? [chunk('tRNS', new Uint8Array(trns))] : []),
      chunk('IDAT', deflateSync(Buffer.from(raw))),
      chunk('IEND', new Uint8Array())
    ])
  )
}
/** An 8-bit RGBA PNG from pixels. */
const png = (px: Px[][], filter = 0) =>
  pngFrom(
    px.map((r) => r.flat()),
    { width: px[0]!.length, filter }
  )
const clear: Px = [0, 0, 0, 0]
const black: Px = [10, 10, 10, 255]
const white: Px = [250, 250, 250, 255]
/** A 4x4 logo: ink in the middle, a see-through border. */
const inked = (ink: Px): Px[][] => [
  [clear, clear, clear, clear],
  [clear, ink, ink, clear],
  [clear, ink, ink, clear],
  [clear, clear, clear, clear]
]
/** A logo on its own box: `box` all round, `ink` in the middle (5x5, so the ink is small). */
const boxed = (box: Px, ink: Px): Px[][] =>
  Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 5 }, (_, x) => (x === 2 && y === 2 ? ink : box))
  )
const svg = (body: string) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`
  )

describe('logoCandidates (ONB-060a)', () => {
  it('finds the logos a page names, surest first, each once, as https links', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"Linen & Co","logo":["/img/logo.svg"]}]}</script>
      <meta property="og:logo" content="https://cdn.example/brand/mark.png">
      <link rel="icon" href="/favicon.ico">
    </head><body>
      <header><a href="/"><img src="http://shop.example/img/brand-black.png" alt="Linen & Co"></a>
        <a href="/account/logout"><img src="/img/logout.png" alt="Log out"></a></header>
      <main><img src="/img/linen-shirt.jpg" alt="A linen shirt"></main>
      <footer><img src="/img/logo-white.png" alt="Linen & Co logo"><img src="data:image/png;base64,AAAA" alt="logo"></footer>
      <img src="/img/logo.svg" alt="White logo">
    </body></html>`
    expect(logoCandidates(html, page)).toEqual([
      // The worse-placed copy's hint is kept.
      {
        url: 'https://shop.example/img/logo.svg',
        hint: 'light',
        from: 'schema'
      },
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

  it('reads lazy pictures past their placeholder, the largest of a srcset, and keeps to its limit', () => {
    const many = Array.from(
      { length: 10 },
      (_, i) =>
        `<img class="logo" data-srcset="/l${i}.png 1x, /c/w_200,h_50/l${i}@2x.png 2x">`
    ).join('')
    const found = logoCandidates(
      `<div itemscope><img itemprop="logo" src="data:image/gif;base64,R0lG" data-src="/brand.png"></div>${many}`,
      page
    )
    expect(found[0]).toEqual({
      url: 'https://shop.example/brand.png',
      hint: null,
      from: 'schema'
    })
    expect(found[1]!.url).toBe('https://shop.example/c/w_200,h_50/l0@2x.png')
    expect(found).toHaveLength(maxCandidates)
  })

  it('never takes other brands’ logos, or a box’s words for a logo’s own', () => {
    const html = `<body>
      <section class="as-seen-in logo-list"><h2>As seen in</h2>
        <img class="logo" src="/press/forbes-white.png" alt="Forbes logo"></section>
      <div class="footer__payments"><img src="/icons/visa-logo.svg" alt="Visa logo"></div>
      <nav class="navbar navbar-dark"><a href="/about" class="brand-logo"><img src="/img/mark.webp" alt="White Fox"></a></nav>
    </body>`
    // The nav link is not home, and its box's "dark" and "logo" are not the picture's.
    expect(logoCandidates(html, page)).toEqual([])
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

  it('reads only ink words in its own names and labels, never the brand’s name', () => {
    expect(inkHint(['/logo-reversed.png'])).toBe('light')
    expect(inkHint(['/LogoWhite.png'])).toBe('light')
    expect(inkHint(['/logo_white_2x.png'])).toBe('light')
    expect(inkHint(['/logo.png', 'Black logo'])).toBe('dark')
    // "dark" and "light" may name a mode: the dark-mode logo is often white.
    expect(inkHint(['/logo-dark.png'])).toBeNull()
    expect(inkHint(['/logo-light.svg'])).toBeNull()
    expect(inkHint(['/darkness.png'])).toBeNull()
    expect(
      inkHint(['/white-fox-logo.webp', 'White Fox'], new Set(['white', 'fox']))
    ).toBeNull()
  })

  it('takes the brand’s name and web address out of the hints, and reads a locale’s home link', () => {
    const html = `<header class="site-header site-header--social"><a href="/en-gb"><img src="/img/white-fox.webp" alt="White Fox"></a></header>`
    expect(logoCandidates(html, page, { brand: 'White Fox' })).toEqual([
      {
        url: 'https://shop.example/img/white-fox.webp',
        hint: null,
        from: 'header'
      }
    ])
    expect(
      logoCandidates(
        '<img class="logo" src="/img/logo-white.png">',
        'https://whitefox.example/'
      )[0]?.hint
    ).toBe('light')
    expect(
      logoCandidates(
        '<img class="logo" src="/img/white-logo.png">',
        'https://white-fox.example/'
      )[0]?.hint
    ).toBeNull()
  })

  it('finds nothing for a page whose address cannot be read', () => {
    expect(
      logoCandidates('<img class="logo" src="/logo.png">', 'not a url')
    ).toEqual([])
  })
})

describe('logoTone (ONB-060a)', () => {
  it('reads the ink of a see-through PNG, whatever its rows’ filters', () => {
    expect(logoTone(png(inked(black)))).toEqual({ tone: 'dark', boxed: false })
    for (const filter of [0, 1, 2, 3, 4]) {
      expect(logoTone(png(inked(white), filter))).toEqual({
        tone: 'light',
        boxed: false
      })
      expect(decodePng(png(inked(white), filter))?.rgba).toEqual(
        decodePng(png(inked(white)))?.rgba
      )
    }
  })

  it('takes a PNG with its own background by its visible edge', () => {
    expect(logoTone(png(boxed(white, black)))).toEqual({
      tone: 'dark',
      boxed: true
    })
    expect(logoTone(png(boxed(black, white)))).toEqual({
      tone: 'light',
      boxed: true
    })
    // A white box with see-through rounded corners is still a white box.
    const rounded: Px[][] = Array.from({ length: 20 }, (_, y) =>
      Array.from({ length: 20 }, (_, x) =>
        (x === 0 || x === 19) && (y === 0 || y === 19)
          ? clear
          : x >= 8 && x < 12 && y >= 8 && y < 12
            ? black
            : white
      )
    )
    expect(logoTone(png(rounded))).toEqual({ tone: 'dark', boxed: true })
  })

  it('reads palette, grey, 16-bit and small-depth PNGs with their see-through colours', () => {
    // Palette: 0 see-through, 1 white.
    const indexed = inked(white).map((row) => row.map((p) => (p[3] ? 1 : 0)))
    expect(
      logoTone(
        pngFrom(indexed, {
          width: 4,
          type: 3,
          bpp: 1,
          palette: [0, 0, 0, 255, 255, 255],
          trns: [0, 255]
        })
      )
    ).toEqual({ tone: 'light', boxed: false })
    // 8-bit grey with grey 0 see-through: white ink.
    const grey = inked(white).map((row) => row.map((p) => (p[3] ? 255 : 0)))
    expect(
      logoTone(pngFrom(grey, { width: 4, type: 0, bpp: 1, trns: [0, 0] }))
    ).toEqual({ tone: 'light', boxed: false })
    // 16-bit RGB with black see-through: dark ink (#141414).
    const rgb16 = inked(black).map((row) =>
      row.flatMap((p) => (p[3] ? [20, 0, 20, 0, 20, 0] : [0, 0, 0, 0, 0, 0]))
    )
    expect(
      logoTone(
        pngFrom(rgb16, {
          width: 4,
          depth: 16,
          type: 2,
          bpp: 6,
          trns: [0, 0, 0, 0, 0, 0]
        })
      )
    ).toEqual({ tone: 'dark', boxed: false })
    // 1-bit grey, all black, no transparency: a dark box.
    const bits = Array.from({ length: 4 }, () => [0b00000000])
    const one = decodePng(
      pngFrom(bits, { width: 4, depth: 1, type: 0, bpp: 1 })
    )
    expect(one?.rgba.slice(0, 4)).toEqual(new Uint8Array([0, 0, 0, 255]))
    expect(
      logoTone(pngFrom(bits, { width: 4, depth: 1, type: 0, bpp: 1 }))
    ).toEqual({ tone: 'light', boxed: true })
  })

  it('refuses broken, lying and oversized PNGs without reading past them', () => {
    // A header chunk too short to hold its fields.
    const short = new Uint8Array(
      Buffer.concat([
        signature,
        chunk('IHDR', new Uint8Array()),
        chunk('IEND', new Uint8Array())
      ])
    )
    expect(decodePng(short)).toBeNull()
    expect(logoTone(short)).toEqual({ tone: 'unknown', boxed: false })
    // Four million pixels in one column, a few kilobytes of file.
    const tall = new Uint8Array(
      Buffer.concat([
        signature,
        chunk('IHDR', ihdr(1, 4_000_000, 1, 0)),
        chunk('IDAT', deflateSync(Buffer.alloc(8_000_000))),
        chunk('IEND', new Uint8Array())
      ])
    )
    const started = Date.now()
    expect(decodePng(tall)).toBeNull()
    expect(Date.now() - started).toBeLessThan(500)
    // Data that inflates to more than the picture needs is refused.
    const bomb = new Uint8Array(
      Buffer.concat([
        signature,
        chunk('IHDR', ihdr(4, 4, 8, 6)),
        chunk('IDAT', deflateSync(Buffer.alloc(5_000_000))),
        chunk('IEND', new Uint8Array())
      ])
    )
    expect(decodePng(bomb)).toBeNull()
    // A chunk claiming more bytes than the file has.
    const lying = Buffer.from(png(inked(black)))
    lying.writeUInt32BE(0xffffff00, 33)
    expect(logoTone(new Uint8Array(lying))).toEqual({
      tone: 'unknown',
      boxed: false
    })
    expect(
      logoTone(
        pngFrom(
          inked(black).map((r) => r.flat()),
          { width: 4, lace: 1 }
        )
      )
    ).toEqual({ tone: 'unknown', boxed: false })
    expect(logoTone(png(inked(clear)))).toEqual({
      tone: 'unknown',
      boxed: false
    })
    expect(logoTone(png(inked(black)).slice(0, 40))).toEqual({
      tone: 'unknown',
      boxed: false
    })
  })

  it('reads an SVG’s drawn colours; with none named it paints black', () => {
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
    // A design tool's export: white only in the shapes that clip.
    const clipped = svg(
      '<g clip-path="url(#a)"><path fill="#111" d="M0 0h9v9z"/></g><defs><clipPath id="a"><rect width="9" height="9" fill="white"/></clipPath><mask id="m"><rect fill="#fff"/></mask></defs>'
    )
    expect(logoTone(clipped)).toEqual({ tone: 'dark', boxed: false })
    // A picture wrapped in an SVG.
    expect(
      logoTone(svg('<image href="logo.png" width="9" height="9"/>'))
    ).toEqual({ tone: 'unknown', boxed: false })
    // With an XML line first.
    expect(
      logoTone(
        new TextEncoder().encode(
          '<?xml version="1.0"?>\n<!-- logo -->\n<svg><path fill="#fff" d="M0 0"/></svg>'
        )
      )
    ).toEqual({ tone: 'light', boxed: false })
  })

  it('knows nothing of other pictures, or of a page that only holds an icon', () => {
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
    expect(
      logoTone(
        new TextEncoder().encode(
          '<html><body>Not found <svg><path fill="#fff"/></svg></body></html>'
        )
      )
    ).toEqual({ tone: 'unknown', boxed: false })
  })
})

describe('hostile pictures (ONB-060a)', () => {
  it('reads them in a moment, whatever they hold', () => {
    const time = (bytes: Uint8Array) => {
      const started = Date.now()
      const tone = logoTone(bytes)
      return { tone, ms: Date.now() - started }
    }
    const comments = time(new TextEncoder().encode('<!---->'.repeat(28) + 'x'))
    expect(comments.tone).toEqual({ tone: 'unknown', boxed: false })
    expect(comments.ms).toBeLessThan(200)
    const masks = time(
      new TextEncoder().encode('<svg>' + '<mask'.repeat(40_000))
    )
    expect(masks.ms).toBeLessThan(500)
    const opened = time(
      new TextEncoder().encode(
        '<svg><path fill="#111" d="M0 0"/>' + '<mask id="m">'.repeat(40_000)
      )
    )
    // An unclosed mask ends what is drawn; what came before still counts.
    expect(opened.tone).toEqual({ tone: 'dark', boxed: false })
    expect(opened.ms).toBeLessThan(500)
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

  it('trusts the pixels over a name, and a see-through logo over a boxed one, both ways', () => {
    expect(
      pickLogos([
        // Named white, but its pixels are dark.
        { candidate: c('a', 'light'), tone: { tone: 'dark', boxed: true } },
        { candidate: c('b'), tone: { tone: 'dark', boxed: false } },
        { candidate: c('d'), tone: { tone: 'light', boxed: true } },
        { candidate: c('e'), tone: { tone: 'light', boxed: false } }
      ])
    ).toEqual({ onLight: 'b', onDark: 'e' })
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

  it('never guesses a light-section logo when every logo measured is light ink', () => {
    expect(
      pickLogos([
        { candidate: c('h', null, 'header'), tone: null },
        { candidate: c('w'), tone: { tone: 'light', boxed: false } }
      ])
    ).toEqual({ onLight: null, onDark: 'w' })
  })
})
