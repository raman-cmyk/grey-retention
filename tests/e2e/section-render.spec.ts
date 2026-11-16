import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from '@playwright/test'
import {
  maxEmailHeight,
  renderEmail,
  renderSection
} from '../../scripts/section-render.mjs'

// DST-001: the designed-section browser in real Chromium. One local server
// plays the section's own picture host (one of its addresses redirects
// elsewhere); the other plays the rest of the internet, which a section
// must never reach while it is drawn.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
)
let own: Server
let outside: Server
let ownHits: string[] = []
let outsideHits: string[] = []
const listen = async (server: Server) => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
let ownBase = ''
let outsideBase = ''

test.beforeAll(async () => {
  own = createServer((req, res) => {
    ownHits.push(req.url ?? '')
    if (req.url === '/redirect')
      return res
        .writeHead(302, { location: `${outsideBase}/via-redirect.png` })
        .end()
    res.writeHead(200, { 'content-type': 'image/png' }).end(png)
  })
  outside = createServer((req, res) => {
    outsideHits.push(req.url ?? '')
    res.writeHead(200, { 'content-type': 'image/png' }).end(png)
  })
  ownBase = await listen(own)
  outsideBase = await listen(outside)
})
test.afterAll(() => {
  own.close()
  outside.close()
})
test.beforeEach(() => {
  ownHits = []
  outsideHits = []
})

/** A JPEG's width and height, from its start-of-frame marker. */
function jpegSize(image: Buffer) {
  let at = 2
  while (at < image.length) {
    const marker = image[at + 1]
    const length = image.readUInt16BE(at + 2)
    if (marker >= 0xc0 && marker <= 0xc2)
      return {
        height: image.readUInt16BE(at + 5),
        width: image.readUInt16BE(at + 7)
      }
    at += 2 + length
  }
  return null
}

test('draws a section at 1,200 px wide, loading only its own pictures and never following a redirect', async ({
  browser
}) => {
  const document = `<!doctype html><html><head><style>html,body{margin:0}#gr-section{width:600px;height:200px;overflow:hidden;background:#2f4a3a url(${ownBase}/backdrop.png)}</style></head><body><div id="gr-section"><img src="${ownBase}/photo.png" alt=""><img src="${ownBase}/redirect" alt=""><img src="${outsideBase}/direct.png" alt=""></div></body></html>`
  const out = await renderSection(browser, {
    document,
    height: 200,
    origins: [ownBase]
  })
  expect(out).toMatchObject({
    contentType: 'image/jpeg',
    width: 1200,
    height: 400
  })
  expect([...out.image.subarray(0, 2)]).toEqual([0xff, 0xd8])
  expect(jpegSize(out.image)).toEqual({ width: 1200, height: 400 })
  expect(ownHits).toEqual(
    expect.arrayContaining(['/photo.png', '/redirect', '/backdrop.png'])
  )
  // Neither directly nor through the redirect.
  expect(outsideHits).toEqual([])
})

// DST-005b: a whole built email in its three views, in real Chromium.
test.describe('the whole-email browser (DST-005b)', () => {
  const email = (body: string) =>
    `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{margin:0}.tall{height:500px}.wide{height:300px}@media (prefers-color-scheme: dark){.tall{height:1000px}}@media (max-width:420px){.wide{height:900px}}</style></head><body>${body}</body></html>`

  test('draws it at its full height: 600 wide, 375 as a phone, and dark mode as the email declares it', async ({
    browser
  }) => {
    const body = `<div class="tall"></div><div class="wide"></div><img src="${ownBase}/a.png" alt="x" width="10" height="10"><img src="${outsideBase}/b.png" alt="y" width="10" height="10">`
    const origins = [ownBase]
    const desktop = await renderEmail(browser, {
      document: email(body),
      view: 'desktop',
      origins
    })
    expect(desktop).toMatchObject({ width: 600, cut: false })
    expect(jpegSize(desktop.image)).toEqual({
      width: 600,
      height: desktop.height
    })
    const phone = await renderEmail(browser, {
      document: email(body),
      view: 'phone',
      origins
    })
    expect(phone.width).toBe(375)
    expect(jpegSize(phone.image)?.width).toBe(375)
    // The phone's own layout (its media query) is drawn.
    expect(phone.height).toBeGreaterThan(desktop.height)
    const dark = await renderEmail(browser, {
      document: email(body),
      view: 'dark',
      origins
    })
    expect(dark.height).toBe(desktop.height + 500)
    // Only its own pictures load.
    expect(ownHits).toContain('/a.png')
    expect(outsideHits).toEqual([])
  })

  test('cuts an email taller than the limit, and says so', async ({
    browser
  }) => {
    const long = await renderEmail(browser, {
      document: email('<div style="height:7000px"></div>'),
      view: 'desktop',
      origins: []
    })
    expect(long).toMatchObject({ height: maxEmailHeight, cut: true })
    expect(jpegSize(long.image)?.height).toBe(maxEmailHeight)
  })
})
