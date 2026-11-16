import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect, type Browser } from '@playwright/test'
import { renderEmail as buildEmail } from '../../features/blocks/render'
import { sampleBlocks, sampleBrand } from '../../features/blocks/samples'
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

/** The colours at the left and right edges of a JPEG, halfway down (read in a page of its own). */
async function edges(browser: Browser, jpeg: Buffer) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.setContent(
      `<img id="i" src="data:image/jpeg;base64,${jpeg.toString('base64')}">`
    )
    await page.waitForFunction(
      () => (document.getElementById('i') as HTMLImageElement).complete
    )
    return await page.evaluate(() => {
      const img = document.getElementById('i') as HTMLImageElement
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const g = canvas.getContext('2d')!
      g.drawImage(img, 0, 0)
      const y = Math.floor(img.naturalHeight / 2)
      const at = (x: number) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]
      return [at(1), at(img.naturalWidth - 2)]
    })
  } finally {
    await context.close()
  }
}

// DST-005b: a whole built email in its three views, in real Chromium.
test.describe('the whole-email browser (DST-005b)', () => {
  const email = (body: string) =>
    `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{margin:0}.tall{height:500px}.wide{height:300px}@media (prefers-color-scheme: dark){.tall{height:1000px}}@media (max-width:420px){.wide{height:900px}}</style></head><body>${body}</body></html>`

  test('draws it at its full height: 600 wide, 375 for a phone, and dark mode as the email declares it', async ({
    browser
  }) => {
    const body = `<div class="tall"></div><div class="wide"></div><img src="${ownBase}/a.png" alt="x" width="10" height="10" style="display:block"><img src="${outsideBase}/b.png" alt="y" width="10" height="10" style="display:block">`
    const origins = [ownBase]
    const desktop = await renderEmail(browser, {
      document: email(body),
      view: 'desktop',
      origins
    })
    expect(desktop).toMatchObject({
      width: 600,
      height: 820,
      cut: false,
      wide: false
    })
    expect(jpegSize(desktop.image)).toEqual({ width: 600, height: 820 })
    const phone = await renderEmail(browser, {
      document: email(body),
      view: 'phone',
      origins
    })
    // The phone's own layout (its media query) is drawn, at 375.
    expect(phone).toMatchObject({ width: 375, height: 820 + 600, wide: false })
    expect(jpegSize(phone.image)).toEqual({ width: 375, height: 1420 })
    const dark = await renderEmail(browser, {
      document: email(body),
      view: 'dark',
      origins
    })
    expect(dark.height).toBe(820 + 500)
    // Only its own pictures load.
    expect(ownHits).toContain('/a.png')
    expect(outsideHits).toEqual([])
  })

  test('lays desktop out wider than the phone layout, as a desktop inbox does (DST-007)', async ({
    browser
  }) => {
    // A real built email (the app's own blocks and phone layout): its
    // three-column grid side by side on desktop and dark, stacked on a phone.
    const built = buildEmail({
      blocks: [sampleBlocks.header_logo, sampleBlocks.product_grid_3col],
      brand: sampleBrand,
      mode: 'preview'
    })
    const desktop = await renderEmail(browser, {
      document: built,
      view: 'desktop',
      origins: []
    })
    const dark = await renderEmail(browser, {
      document: built,
      view: 'dark',
      origins: []
    })
    const phone = await renderEmail(browser, {
      document: built,
      view: 'phone',
      origins: []
    })
    expect(desktop).toMatchObject({ width: 600, wide: false })
    expect(dark).toMatchObject({ width: 600, height: desktop.height })
    expect(phone).toMatchObject({ width: 375, wide: false })
    // Measured in plain pages: at 700 the desktop layout, at 600 already
    // the phone one (taller: the grid stacks). Desktop is the first.
    const at = async (width: number) => {
      const context = await browser.newContext({
        viewport: { width, height: 100 }
      })
      try {
        const page = await context.newPage()
        await page.setContent(built)
        return await page.evaluate(() =>
          Math.ceil(document.documentElement.getBoundingClientRect().height)
        )
      } finally {
        await context.close()
      }
    }
    expect(Math.abs(desktop.height - (await at(700)))).toBeLessThanOrEqual(1)
    expect(await at(600)).toBeGreaterThan(desktop.height + 200)
    // The picture is the email's own 600 px, from the middle of its
    // window: both edges are the email, never the page around it.
    const framed = (inside: string) =>
      `<!doctype html><html><head><style>body{margin:0;background:#ff0000}</style></head><body><table width="100%" cellpadding="0" cellspacing="0" bgcolor="#ff0000"><tr><td align="center"><table class="gr-wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;background:#00ff00"><tr>${inside}</tr></table></td></tr></table></body></html>`
    const centred = await renderEmail(browser, {
      document: framed('<td style="height:300px">&nbsp;</td>'),
      view: 'desktop',
      origins: []
    })
    expect(centred).toMatchObject({ width: 600, height: 300, wide: false })
    const [left, right] = await edges(browser, centred.image)
    for (const [r, g, b] of [left, right]) {
      expect(g).toBeGreaterThan(200)
      expect(r + b).toBeLessThan(80)
    }
    // A frame grown past 600 by what is in it is cut by the picture: wide.
    const grown = await renderEmail(browser, {
      document: framed(
        '<td><div style="width:300px;padding:0 20px;height:300px"></div></td><td><div style="width:300px;padding:0 20px;height:300px"></div></td>'
      ),
      view: 'desktop',
      origins: []
    })
    expect(grown).toMatchObject({ width: 600, wide: true })
    // Wider than its 700 px window: wide on desktop too.
    const wide = await renderEmail(browser, {
      document: email('<div style="width:760px;height:300px"></div>'),
      view: 'desktop',
      origins: []
    })
    expect(wide).toMatchObject({ width: 600, height: 300, wide: true })
  })

  test('measures a short email as it is, and says when something is wider than its window', async ({
    browser
  }) => {
    const short = await renderEmail(browser, {
      document: email('<div style="height:200px"></div>'),
      view: 'desktop',
      origins: []
    })
    expect(short).toMatchObject({ height: 200, cut: false, wide: false })
    expect(jpegSize(short.image)?.height).toBe(200)
    // A 600 px table on a phone: drawn at 375, and said to be wide.
    const wide = await renderEmail(browser, {
      document: email(
        '<table width="600" cellpadding="0" cellspacing="0" style="width:600px"><tr><td style="height:400px">x</td></tr></table>'
      ),
      view: 'phone',
      origins: []
    })
    expect(wide).toMatchObject({ width: 375, height: 400, wide: true })
    expect(jpegSize(wide.image)?.width).toBe(375)
    // An empty page, or one that scrolls inside itself, is not drawn.
    for (const page of [
      email(''),
      '<!doctype html><html><head><style>html{overflow:hidden;height:100%}body{height:100%;overflow:auto;margin:0}</style></head><body><div style="height:3000px"></div></body></html>'
    ])
      await expect(
        renderEmail(browser, { document: page, view: 'desktop', origins: [] })
      ).rejects.toThrow('failed')
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

  test('never draws a page that would reach out past the guard', async ({
    browser
  }) => {
    outsideHits = []
    for (const head of [
      `<link rel="prefetch" href="${outsideBase}/prefetch">`,
      `<LINK rel=preconnect href="${outsideBase}">`,
      `<meta http-equiv="refresh" content="0;url=${outsideBase}/away">`,
      `<iframe srcdoc="&lt;link rel=prefetch href=${outsideBase}/inner&gt;"></iframe>`
    ])
      await expect(
        renderEmail(browser, {
          document: email(`${head}<div style="height:300px"></div>`),
          view: 'desktop',
          origins: [ownBase]
        })
      ).rejects.toThrow('navigated')
    await new Promise((done) => setTimeout(done, 300))
    expect(outsideHits).toEqual([])
  })
})
