// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { sheetTimeoutMs } from './fetch'
import {
  maxFamilies,
  maxStylesheets,
  maxTotalCss,
  type FontFile,
  type Sheet,
  type SiteFont
} from './fonts'
import { mergeSiteFonts, pageFonts, sheetReader } from './site-fonts'

const file = (name: string, extra: Partial<FontFile> = {}): FontFile => ({
  url: `https://cedarlane.com/cdn/fonts/${name}.woff2`,
  format: 'woff2',
  weight: 400,
  italic: false,
  unicodeRange: null,
  ...extra
})
const font = (
  family: string,
  roles: SiteFont['roles'],
  files: FontFile[] = [],
  kind: SiteFont['kind'] = files.length ? 'self-hosted' : 'unknown'
): SiteFont => ({ family, roles, kind, files })

describe('mergeSiteFonts (FONT-b)', () => {
  it('keeps each family once with every role, heading fonts first, then body, then fonts only loaded', () => {
    const merged = mergeSiteFonts([
      [font('Dawn Sans', ['body']), font('Loaded', [])],
      undefined, // a page not read for fonts
      null, // a page whose fonts could not be read
      [font('cedar serif', ['heading']), font('DAWN SANS', ['heading'])]
    ])
    expect(merged.map((f) => [f.family, f.roles])).toEqual([
      ['Dawn Sans', ['heading', 'body']],
      ['cedar serif', ['heading']],
      ['Loaded', []]
    ])
    const many = Array.from({ length: 10 }, (_, i) => font(`Font ${i}`, []))
    expect(mergeSiteFonts([many]).map((f) => f.family)).toEqual(
      many.slice(0, maxFamilies).map((f) => f.family)
    )
    expect(mergeSiteFonts([])).toEqual([])
  })

  it('keeps the first page’s files first, each once, two per weight and style, twelve in all', () => {
    const weights = Array.from({ length: 12 }, (_, i) =>
      file(`w${i}`, { weight: 100 + i * 50 })
    )
    const [cedar] = mergeSiteFonts([
      [font('Cedar', ['heading'])],
      [
        font(
          'Cedar',
          [],
          [file('a'), file('a-ext'), file('b', { weight: 700 })]
        )
      ],
      [
        font(
          'Cedar',
          ['body'],
          [file('a'), file('c'), file('d', { italic: true }), ...weights],
          'google'
        )
      ]
    ])
    expect(cedar!.files.map((f) => f.url.split('/').pop())).toEqual(
      [
        'a',
        'a-ext',
        'b',
        'd',
        'w0',
        'w1',
        'w2',
        'w3',
        'w4',
        'w5',
        'w7',
        'w8'
      ].map((n) => `${n}.woff2`)
    )
    // Who serves it: the first page that found its files.
    expect(cedar!.kind).toBe('self-hosted')
    const [named] = mergeSiteFonts([
      [font('Inter', [])],
      [font('Inter', [], [], 'google')],
      [font('Inter', [], [], 'system')]
    ])
    expect(named!.kind).toBe('google')
  })
})

describe('sheetReader (FONT-b)', () => {
  const sheet = (url: string, size = 10): Sheet => ({
    url,
    css: 'a'.repeat(size)
  })

  it('reads each stylesheet once, at most twelve, within the CSS cap and the time left', async () => {
    const load = vi.fn(async (url: string) =>
      url.includes('fail')
        ? Promise.reject(new Error('reset'))
        : url.includes('big')
          ? sheet(url, maxTotalCss)
          : sheet(url)
    )
    let now = 0
    const read = sheetReader(load, { now: () => now, deadline: 10_000 })
    expect(await read('https://x.com/a.css')).toEqual(
      sheet('https://x.com/a.css')
    )
    expect(await read('https://x.com/a.css')).toEqual(
      sheet('https://x.com/a.css')
    )
    expect(load).toHaveBeenCalledTimes(1)
    // Over the run's CSS cap, or failed: skipped.
    expect(await read('https://x.com/big.css')).toBeNull()
    expect(await read('https://x.com/fail.css')).toBeNull()
    for (let i = 3; i < maxStylesheets; i++)
      expect(await read(`https://x.com/${i}.css`)).not.toBeNull()
    expect(await read('https://x.com/13th.css')).toBeNull()
    expect(load).toHaveBeenCalledTimes(maxStylesheets)
    // None started without the time one may take.
    const late = sheetReader(load, { now: () => now, deadline: 10_000 })
    now = 10_000 - sheetTimeoutMs + 1
    expect(await late('https://x.com/late.css')).toBeNull()
    expect(load).toHaveBeenCalledTimes(maxStylesheets)
  })
})

describe('pageFonts (FONT-b)', () => {
  const page = {
    url: 'https://cedarlane.com/',
    html: `<html><head>
      <link rel="stylesheet" href="/cdn/theme.css">
      <link rel="stylesheet" href="/cdn/missing.css">
      <link rel="stylesheet" href="https://evil.com/fonts.css">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dawn+Sans">
    </head><body><h1>Trail socks</h1></body></html>`
  }
  const sheets: Record<string, string> = {
    'https://cedarlane.com/cdn/theme.css':
      '@import url("faces.css"); h1, .h2 { font-family: var(--font-heading-family), serif } body { font-family: "Dawn Sans", sans-serif } :root { --font-heading-family: "Cedar Serif" }',
    'https://cedarlane.com/cdn/faces.css':
      '@import "deeper.css"; @font-face { font-family: "Cedar Serif"; font-weight: 700; src: url(cedar-700.woff2) format("woff2") }',
    'https://fonts.googleapis.com/css2?family=Dawn+Sans':
      '@font-face { font-family: "Dawn Sans"; src: url(https://fonts.gstatic.com/s/dawnsans/v1/a.woff2) format("woff2"); unicode-range: U+0000-00FF }'
  }
  const load = vi.fn(async (url: string) =>
    sheets[url] ? { url, css: sheets[url]! } : null
  )

  it('reads the fonts its linked stylesheets set, one @import deep, never another site’s', async () => {
    expect(await pageFonts(page, load)).toEqual([
      {
        family: 'Cedar Serif',
        roles: ['heading'],
        kind: 'self-hosted',
        files: [
          {
            url: 'https://cedarlane.com/cdn/cedar-700.woff2',
            format: 'woff2',
            weight: 700,
            italic: false,
            unicodeRange: null
          }
        ]
      },
      {
        family: 'Dawn Sans',
        roles: ['body'],
        kind: 'google',
        files: [
          expect.objectContaining({
            url: 'https://fonts.gstatic.com/s/dawnsans/v1/a.woff2',
            unicodeRange: 'U+0000-00FF'
          })
        ]
      }
    ])
    const asked = load.mock.calls.map(([url]) => url)
    expect(asked.sort()).toEqual([
      'https://cedarlane.com/cdn/faces.css',
      'https://cedarlane.com/cdn/missing.css',
      'https://cedarlane.com/cdn/theme.css',
      'https://fonts.googleapis.com/css2?family=Dawn+Sans'
    ])
  })

  it('says nothing when it links stylesheets and none can be read, and gives its own fonts when it links none', async () => {
    const own = '<style>h1 { font-family: "Inline Serif" }</style>'
    // Null: the caller keeps what it had, never a weaker list.
    expect(
      await pageFonts({ ...page, html: page.html + own }, async () => null)
    ).toBeNull()
    expect(
      await pageFonts({ url: page.url, html: own }, async () => {
        throw new Error('never asked')
      })
    ).toEqual([
      { family: 'Inline Serif', roles: ['heading'], kind: 'unknown', files: [] }
    ])
  })

  it('reads the page no further once the time is up', async () => {
    let calls = 0
    // Up after its linked sheets, or only before its last read.
    for (const upAt of [1, 2]) {
      calls = 0
      expect(await pageFonts(page, load, () => ++calls >= upAt)).toBeNull()
      expect(calls).toBe(upAt)
    }
  })
})
