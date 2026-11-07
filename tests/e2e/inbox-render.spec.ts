import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from '@playwright/test'
import { prepareHtml, render } from '../../scripts/inbox-screenshots.mjs'

// INB-002: the screenshot browser in real Chromium. One local server plays
// the job's own signed storage links; the other plays the rest of the
// internet, which an email must never reach while it is photographed.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
)
let allowed: Server
let outside: Server
let outsideHits: string[] = []
const listen = async (server: Server) => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
let allowedBase = ''
let outsideBase = ''

test.beforeAll(async () => {
  allowed = createServer((_, res) =>
    res.writeHead(200, { 'content-type': 'image/png' }).end(png)
  )
  outside = createServer((req, res) => {
    outsideHits.push(req.url ?? '')
    res.writeHead(200).end('x')
  })
  allowedBase = await listen(allowed)
  outsideBase = await listen(outside)
})
test.afterAll(() => {
  allowed.close()
  outside.close()
})
test.beforeEach(() => {
  outsideHits = []
})

const job = () => ({
  html: `${allowedBase}/email.html?token=t`,
  images: [
    {
      ref: 'https://cdn.shop.example/hero.png',
      url: `${allowedBase}/hero.png?token=i`
    }
  ]
})

test('INB-002 the screenshot is the whole email, also with height:100% CSS', async ({
  browser
}) => {
  const html = prepareHtml(
    `<html style="height:100%"><head><style>body,#bodyTable,#bodyCell{height:100%!important;margin:0}</style></head>
     <body><table id="bodyTable" width="100%"><tr><td id="bodyCell">
       <table width="600"><tr><td><img src="https://cdn.shop.example/hero.png" width="600" height="300"></td></tr>
       <tr><td style="height:2800px">Long email</td></tr></table>
     </td></tr></table></body></html>`,
    job().images
  )
  const shot = await render(browser, job(), html)
  // The table and its cell padding are a little wider than 600px: the
  // picture keeps all of it rather than cutting the right edge off.
  expect(shot.width).toBeGreaterThanOrEqual(600)
  expect(shot.width).toBeLessThan(640)
  expect(shot.height).toBeGreaterThanOrEqual(3000)
  expect(shot.image.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
})

test('INB-002 nothing outside the job’s own links is loaded, scripts do not run and the page never navigates', async ({
  browser
}) => {
  const html = prepareHtml(
    `<html><head>
       <meta http-equiv="refresh" content="0;url=${outsideBase}/refresh">
       <link rel="stylesheet" href="${outsideBase}/style.css">
       <link rel="prefetch" href="${outsideBase}/prefetch">
       <style>@import url("${outsideBase}/import.css"); @font-face{font-family:x;src:url(${outsideBase}/font.woff)}
         body{font-family:x;background:url(${outsideBase}/bg.png)}</style>
     </head><body>
       <img src="https://cdn.shop.example/hero.png" width="600">
       <img src="${outsideBase}/pixel.gif">
       <iframe src="${outsideBase}/frame"></iframe>
       <script>document.title='ran';new Image().src='${outsideBase}/script'</script>
       <p>Hello</p>
     </body></html>`,
    job().images
  )
  const shot = await render(browser, job(), html)
  expect(shot.height).toBeGreaterThan(0)
  // Give anything late a moment to (not) arrive.
  await new Promise((done) => setTimeout(done, 300))
  expect(outsideHits).toEqual([])
})

test('INB-002 a page that tries to leave is refused rather than photographed', async ({
  browser
}) => {
  // A refresh written so prepareHtml cannot see it still never navigates.
  const html = `<html><head><meta http-equiv="refresh" content="0;url=${outsideBase}/away"></head><body>Hi</body></html>`
  await render(browser, job(), html).catch(() => null)
  expect(outsideHits).toEqual([])
})

test('INB-003 each marked section gets its own picture, cut where it sits', async ({
  browser
}) => {
  const html = `<html><body style="margin:0"><table width="600" cellpadding="0" cellspacing="0">
    <tr data-gr-section="1"><td style="height:120px">Header</td></tr>
    <tr data-gr-section="2"><td style="height:400px">Hero</td></tr>
    <tr data-gr-section="3"><td style="height:80px">Footer</td></tr>
  </table></body></html>`
  const shot = await render(
    browser,
    {
      ...job(),
      sections: [1, 2, 3].map((ordinal) => ({ ordinal, upload: 'unused' }))
    },
    html
  )
  expect(shot.sections.map((s) => [s.ordinal, s.top, s.height])).toEqual([
    [1, 0, 120],
    [2, 120, 400],
    [3, 520, 80]
  ])
  for (const s of shot.sections)
    expect(s.image.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
})
