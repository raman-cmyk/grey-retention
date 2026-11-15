import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from '@playwright/test'
import { renderSection } from '../../scripts/section-render.mjs'

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
