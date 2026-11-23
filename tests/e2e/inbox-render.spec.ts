import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect, type Browser } from '@playwright/test'
import { prepareHtml, render, run } from '../../scripts/inbox-screenshots.mjs'

// INB-002: the screenshot browser in real Chromium. One local server plays
// the job's own signed storage links; the other plays the rest of the
// internet, which an email must never reach while it is photographed.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
)
let allowed: Server
let outside: Server
// INB-002b: a second loopback address stands in for a private one (a
// cloud's metadata address or the office network); where the machine has
// none (macOS), the same loopback under the name localhost does.
let privateHost: Server
let allowedHits: string[] = []
let outsideHits: string[] = []
let privateHits: string[] = []
const listen = async (server: Server, host = '127.0.0.1') => {
  await new Promise<void>((done) => server.listen(0, host, done))
  return `http://${host}:${(server.address() as AddressInfo).port}`
}
let allowedBase = ''
let outsideBase = ''
let privateBase = ''

// Where each of the job's own addresses redirects (INB-002b).
const redirects: Record<string, () => string> = {
  '/redirect.png': () => `${outsideBase}/via-redirect.png`,
  '/redirect-bg.png': () => `${outsideBase}/via-background.png`,
  '/redirect-nav': () => `${outsideBase}/via-refresh`,
  '/private.png': () => `${privateBase}/latest/meta-data`,
  '/chain-1.png': () => `${allowedBase}/chain-2.png`,
  '/chain-2.png': () => `${outsideBase}/via-chain.png`,
  '/style.css': () => `${outsideBase}/via-style.css`
}
// A picture of one colour, to find in the screenshot.
const red = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="100"><rect width="600" height="100" fill="#ff0000"/></svg>`
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** A tiny app and storage for `run`: jobs, the emails, a slow style chain. */
let appJobs: unknown[] = []
let reports: unknown[] = []
async function app(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse
) {
  const url = req.url ?? ''
  if (url === '/api/internal/inbox/screenshots') {
    if (req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      reports.push(JSON.parse(body))
      return res.writeHead(200).end('{}')
    }
    const jobs = appJobs
    appJobs = []
    return res.writeHead(200).end(JSON.stringify({ jobs }))
  }
  if (url.startsWith('/upload/')) return res.writeHead(200).end()
  if (url === '/slow.html')
    return res
      .writeHead(200)
      .end(`<style>@import url(${allowedBase}/chain/1.css);</style>Slow`)
  if (url === '/ok.html') return res.writeHead(200).end('<p>Hello</p>')
  const step = /^\/chain\/(\d+)\.css$/.exec(url)
  if (step) {
    // Each step answers in time, but the chain outlasts the page's time.
    await wait(250)
    return res
      .writeHead(200, { 'content-type': 'text/css' })
      .end(`@import url(/chain/${Number(step[1]) + 1}.css);`)
  }
  if (url === '/hang.png') return // never answers
  if (url === '/red.svg')
    return res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(red)
  return null
}

test.beforeAll(async () => {
  allowed = createServer(async (req, res) => {
    allowedHits.push(req.url ?? '')
    const to = redirects[req.url ?? '']
    if (to) return res.writeHead(302, { location: to() }).end()
    if ((await app(req, res)) !== null) return
    res.writeHead(200, { 'content-type': 'image/png' }).end(png)
  })
  outside = createServer((req, res) => {
    outsideHits.push(req.url ?? '')
    // What a prefetch would follow: on to a private address.
    if (req.url?.startsWith('/pf'))
      return res
        .writeHead(302, { location: `${privateBase}/via-prefetch` })
        .end()
    res.writeHead(200).end('x')
  })
  privateHost = createServer((req, res) => {
    privateHits.push(req.url ?? '')
    res.writeHead(200).end('x')
  })
  allowedBase = await listen(allowed)
  outsideBase = await listen(outside)
  privateBase = await listen(privateHost, '127.0.0.2').catch(async () =>
    (await listen(privateHost)).replace('127.0.0.1', 'localhost')
  )
})
test.afterAll(() => {
  allowed.close()
  outside.close()
  privateHost.close()
})
test.beforeEach(() => {
  allowedHits = []
  outsideHits = []
  privateHits = []
  appJobs = []
  reports = []
})

/** The colour of one pixel of a JPEG (read in a page of its own). */
async function pixel(browser: Browser, jpeg: Uint8Array, x: number, y: number) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.setContent(
      `<img id="i" src="data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}">`
    )
    await page.waitForFunction(
      () => (document.getElementById('i') as HTMLImageElement).complete
    )
    return await page.evaluate(
      ([px, py]) => {
        const img = document.getElementById('i') as HTMLImageElement
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const g = canvas.getContext('2d')!
        g.drawImage(img, 0, 0)
        return [...g.getImageData(px!, py!, 1, 1).data.slice(0, 3)]
      },
      [x, y]
    )
  } finally {
    await context.close()
  }
}

const count = (hits: string[], url: string) =>
  hits.filter((hit) => hit === url).length

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

test('INB-002b an address of the job’s own that redirects is refused: to another host, a private address or along a chain', async ({
  browser
}) => {
  // A refresh to the job's own redirecting address, written with an entity
  // in its name: the tag is made inert, and a navigation is refused anyway.
  const html = prepareHtml(
    `<html><head>
       <meta http-equiv="&#82;efresh" content="0;url=${allowedBase}/redirect-nav">
       <style>@import url("${allowedBase}/style.css");
         body{margin:0;background:url(${allowedBase}/redirect-bg.png)}</style>
     </head><body>
       <img src="${allowedBase}/red.svg" width="600" height="100" style="display:block">
       <img src="https://cdn.shop.example/hero.png" width="600">
       <img src="${allowedBase}/redirect.png">
       <img src="${allowedBase}/private.png">
       <img src="${allowedBase}/chain-1.png">
       <p>Hello</p>
     </body></html>`,
    job().images
  )
  const shot = await render(browser, job(), html)
  expect(shot.height).toBeGreaterThan(0)
  await wait(300)
  // Each redirecting address was asked exactly once, and its answer refused.
  for (const url of [
    '/redirect.png',
    '/redirect-bg.png',
    '/private.png',
    '/chain-1.png',
    '/style.css'
  ])
    expect([url, count(allowedHits, url)]).toEqual([url, 1])
  // The refresh never went; the chain stops at its first step.
  expect(count(allowedHits, '/redirect-nav')).toBe(0)
  expect(count(allowedHits, '/chain-2.png')).toBe(0)
  expect(outsideHits).toEqual([])
  expect(privateHits).toEqual([])
  // The five refused, and the job's own pictures were drawn: red on top.
  expect(shot.unloaded).toBe(5)
  const [r, g, b] = await pixel(browser, shot.image, 300, 50)
  expect(r).toBeGreaterThan(200)
  expect(Math.max(g!, b!)).toBeLessThan(60)
})

test('INB-002b a link, meta or base the browser would follow on its own is made inert, however it is written', async ({
  browser
}) => {
  // Each shape kept a <link> past the old whole-tag pattern ("<" inside an
  // attribute, upper case over lines, inside SVG); a prefetch skips the
  // route guard, so only making the tag inert stops it.
  const html = prepareHtml(
    `<html><head>
       <link rel=prefetch href="${outsideBase}/pf?<">
       <LINK
rel=prefetch
title="<"
href="${outsideBase}/pf-upper">
       <link rel="dns-prefetch preconnect" href="${outsideBase}/pc?<">
       <meta http-equiv="refresh" content="0;url=${outsideBase}/refresh?<">
       <base href="${outsideBase}/base/">
     </head><body>
       <svg width="10" height="10"><foreignObject width="10" height="10"><link rel="prefetch" href="${outsideBase}/pf-svg?<"></foreignObject></svg>
       <img src="relative.png" alt="">
       <p>Hello</p>
     </body></html>`,
    job().images
  )
  expect(html).not.toMatch(/<(link|meta|base)\b/i)
  const shot = await render(browser, job(), html)
  expect(shot.height).toBeGreaterThan(0)
  // A prefetch goes at low priority, after the page loads: give it time.
  await wait(1000)
  expect(outsideHits).toEqual([])
  expect(privateHits).toEqual([])
})

test('INB-002b an email keeps its own layout once its head tags are made inert', async ({
  browser
}) => {
  // Almost every email has <meta> and <link> in its head. Made inert as an
  // unknown tag, they wrapped the whole body, so a `body > table` rule
  // stopped matching (second review); an empty hidden <wbr> wraps nothing.
  const html = prepareHtml(
    `<html><head>
       <meta charset="utf-8">
       <meta name="viewport" content="width=device-width">
       <link rel="stylesheet" href="${outsideBase}/font.css">
       <style>
         body { margin: 0; background: #fff; }
         body > table { background: #ff0000; width: 600px; height: 200px; }
       </style>
     </head><body><table><tr><td></td></tr></table></body></html>`,
    job().images
  )
  const page = await browser.newPage()
  try {
    await page.setContent(html)
    const parent = await page.evaluate(
      () => document.querySelector('table')?.parentElement?.tagName
    )
    expect(parent).toBe('BODY')
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector('table')!).backgroundColor
    )
    expect(color).toBe('rgb(255, 0, 0)')
  } finally {
    await page.close()
  }
})

test('INB-002b a picture that never answers is dropped and the email still photographed; a page that outlasts its time fails alone and the run goes on', async ({
  browser
}) => {
  const times = { loadMs: 300, pageMs: 1000 }
  const shot = await render(
    browser,
    job(),
    `<html><body><img src="${allowedBase}/hang.png"><p>Hello</p></body></html>`,
    Date.now() + 10_000,
    times
  )
  expect(shot.height).toBeGreaterThan(0)
  expect(shot.unloaded).toBe(1)

  const unhandled: unknown[] = []
  const onRejection = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', onRejection)
  try {
    const one = (name: string, html: string) => ({
      job: name,
      lease: 'l1',
      html: `${allowedBase}/${html}`,
      images: [],
      upload: `${allowedBase}/upload/${name}.jpg`,
      sections: []
    })
    appJobs = [one('slow', 'slow.html'), one('ok', 'ok.html')]
    const lines: string[] = []
    const counts = await run({
      base: allowedBase,
      secret: 's'.repeat(40),
      browser,
      log: (line) => lines.push(line),
      times
    })
    expect(counts).toMatchObject({ taken: 1, failed: 1 })
    expect(reports).toEqual([
      { job: 'slow', lease: 'l1', failure: 'render_failed' },
      expect.objectContaining({ job: 'ok', lease: 'l1', boxes: [] })
    ])
    expect(lines.join('\n')).toMatch(
      /^Screenshots taken: 1\. Failed: 1\. Stored pictures or styles refused or failed: \d+\.$/
    )
    // The chain's late answers arrive after the page closed: nothing breaks.
    await wait(1000)
    expect(unhandled).toEqual([])
  } finally {
    process.off('unhandledRejection', onRejection)
  }
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
