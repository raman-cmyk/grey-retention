// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import { launch } from '@/lib/sandbox/browser.mjs'
import type { ImagePart } from './blueprint'
import { browserLimits, desktopWindow, measureHtml, pictureOf } from './browser'
import { blueprintFrom } from './measure'

/**
 * DES-ENGINE-001: the measuring browser's sandbox and limits in real
 * Chromium, as the inbox screenshot tests check theirs
 * (`tests/e2e/inbox-render.spec.ts`). One loopback server plays the
 * email's own stored pictures (the only allowed origin); the other plays
 * the rest of the internet, which an email must never reach while it is
 * measured. `DESIGN_ENGINE_BROWSER=on`.
 */
const on = process.env.DESIGN_ENGINE_BROWSER === 'on'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
)
let allowed: Server
let outside: Server
let allowedBase = ''
let outsideBase = ''
let allowedHits: string[] = []
let outsideHits: string[] = []
const listen = async (server: Server) => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** The JPEG's height in pixels (its first frame header). */
function jpegHeight(jpeg: Buffer) {
  for (let i = 2; i < jpeg.length - 8; i++)
    if (jpeg[i] === 0xff && (jpeg[i + 1] === 0xc0 || jpeg[i + 1] === 0xc2))
      return jpeg.readUInt16BE(i + 5)
  return -1
}

describe.skipIf(!on)('the measuring browser’s sandbox and limits', () => {
  let browser: Browser
  beforeAll(async () => {
    allowed = createServer((req, res) => {
      const url = req.url ?? ''
      allowedHits.push(url)
      if (url === '/ok.png')
        return res.writeHead(200, { 'content-type': 'image/png' }).end(png)
      if (url === '/redirect-out.png')
        return res
          .writeHead(302, { location: `${outsideBase}/via-redirect.png` })
          .end()
      if (url === '/redirect-here.png')
        return res.writeHead(302, { location: '/other-path.png' }).end()
      if (url === '/hang.png') return // never answers
      return res.writeHead(404).end()
    })
    outside = createServer((req, res) => {
      outsideHits.push(req.url ?? '')
      res.writeHead(200, { 'content-type': 'image/png' }).end(png)
    })
    allowedBase = await listen(allowed)
    outsideBase = await listen(outside)
    const { chromium } = await import('@playwright/test')
    browser = await launch(chromium)
  })
  afterAll(async () => {
    await browser?.close()
    allowed?.close()
    outside?.close()
  })
  beforeEach(() => {
    allowedHits = []
    outsideHits = []
  })

  it('loads only the allowed origin’s own addresses, never a redirect, script, style or refresh', async () => {
    const html = `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${outsideBase}/via-refresh"><link rel="stylesheet" href="${outsideBase}/via-link.css"><style>@import url(${outsideBase}/via-import.css);.bg{background:url(${outsideBase}/via-css-url.png)}</style></head><body><script>new Image().src='${outsideBase}/via-script.png';document.body.setAttribute('data-ran','1')</script><table width="600">
<tr><td><img src="${allowedBase}/ok.png" width="200" height="100" alt="Allowed"></td></tr>
<tr><td><img src="${allowedBase}/redirect-out.png" width="200" height="100" alt="Out"></td></tr>
<tr><td><img src="${allowedBase}/redirect-here.png" width="200" height="100" alt="Here"></td></tr>
<tr><td><img src="${outsideBase}/sizeless.png" alt="Sizeless"></td></tr>
<tr><td class="bg" style="height:40px;background-image:url(${outsideBase}/via-inline-style.png)">Words</td></tr>
</table></body></html>`
    const got = await measureHtml(browser, html, desktopWindow, {
      origins: [allowedBase]
    })
    if (!got.ok) throw new Error(got.error)
    // Only the allowed origin, and only the addresses the email names:
    // neither redirect was followed, not even to another path there.
    expect([...new Set(allowedHits)].sort()).toEqual([
      '/ok.png',
      '/redirect-here.png',
      '/redirect-out.png'
    ])
    expect(outsideHits).toEqual([])
    // The script never ran (JavaScript is off).
    const body = got.measurement.nodes.find((n) => n.tag === 'body')!
    expect(body.attrs).not.toHaveProperty('data-ran')
    const bp = blueprintFrom(got.measurement)
    if (!bp.ok) throw new Error(bp.error)
    expect(bp.blueprint.sections[0]!.items[0]).toMatchObject({
      type: 'image',
      // A loopback test address is http, which a blueprint does not keep.
      src: null,
      width: 200,
      height: 100
    })
    // The page never left about:blank: the refresh was made inert first.
    expect(outsideHits.filter((h) => h === '/via-refresh')).toEqual([])
  }, 60_000)

  it('keeps a held picture’s address and size, as the blueprint needs it', async () => {
    const html = `<table width="600"><tr><td><img src="${outsideBase}/held.png?a=$&b=$'" width="300" height="150" alt="Held"></td></tr><tr><td style="font:16px/24px Arial">Words</td></tr></table>`
    const got = await measureHtml(browser, html)
    if (!got.ok) throw new Error(got.error)
    expect(outsideHits).toEqual([])
    const bp = blueprintFrom(got.measurement)
    if (!bp.ok) throw new Error(bp.error)
    const pic = bp.blueprint.sections[0]!.items[0] as ImagePart
    expect(pic).toMatchObject({ width: 300, height: 150 })
    // http is not kept as a picture address (Klaviyo takes https only).
    expect(pic.src).toBeNull()
  }, 60_000)

  it('gives up on a picture that never answers, and on a measurement out of time', async () => {
    const html = `<table width="600"><tr><td><img src="${allowedBase}/hang.png" width="100" height="100" alt=""></td></tr></table>`
    const quick = await measureHtml(browser, html, desktopWindow, {
      origins: [allowedBase],
      timeoutMs: 500
    })
    expect(quick.ok).toBe(true)
    const late = await measureHtml(browser, html, desktopWindow, {
      origins: [allowedBase],
      deadlineMs: 300
    })
    expect(late).toEqual({
      ok: false,
      error: 'The email took too long to open in the browser.'
    })
  }, 60_000)

  it('refuses an email over a limit with a plain reason', async () => {
    const tall = `<table width="600"><tr><td style="height:${browserLimits.height + 1000}px">Tall</td></tr></table>`
    const high = await measureHtml(browser, tall)
    expect(high.ok).toBe(false)
    expect(!high.ok && high.error).toMatch(
      new RegExp(
        `^The email is 170\\d\\d px tall; at most ${browserLimits.height} can be measured\\.$`
      )
    )
    const busy = `<table width="600"><tr><td>${'<b>a</b> '.repeat(browserLimits.nodes)}</td></tr></table>`
    const many = await measureHtml(browser, busy)
    expect(many.ok).toBe(false)
    expect(!many.ok && many.error).toMatch(
      new RegExp(`at most ${browserLimits.nodes} can be measured`)
    )
    const huge = 'x'.repeat(browserLimits.inputBytes + 1)
    expect(await measureHtml(browser, huge)).toEqual({
      ok: false,
      error: 'The email is larger than 2 MB.'
    })
  }, 60_000)

  it('cuts a picture for the owner at 6,000 px', async () => {
    const html = `<table width="600"><tr><td style="height:9000px;background:#dddddd">Long</td></tr></table>`
    const image = await pictureOf(browser, html)
    expect(jpegHeight(image)).toBe(browserLimits.pictureHeight)
    expect(image.byteLength).toBeLessThan(browserLimits.pictureBytes)
  }, 60_000)
})
