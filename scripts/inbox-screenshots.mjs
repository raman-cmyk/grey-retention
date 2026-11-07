#!/usr/bin/env node
/**
 * The Inspiration inbox screenshot browser (INB-002). A scheduled GitHub
 * Actions job runs it; it can also run on a developer machine against the
 * local app.
 *
 *   APP_URL=https://… CRON_SECRET=… node scripts/inbox-screenshots.mjs
 *
 * It asks the app for one email to photograph at a time, renders it at
 * 600px wide in Chromium with JavaScript off and with only the job's own
 * signed links allowed (the email HTML and its stored images; every other
 * request and every navigation is blocked), uploads a full-height JPEG
 * through the job's signed upload link and reports the size back. It
 * prints counts only: never a link, never the secret.
 */
import { pathToFileURL } from 'node:url'

export const width = 600
export const maxWidth = 2000
export const maxHeight = 16000
/** The bucket takes 10 MiB; stay under it. */
export const maxBytes = 9.5 * 1024 * 1024
/** Emails photographed per run at most. */
export const perRun = 20

/**
 * Puts each stored image in place of the reference the HTML uses, and
 * removes what would reach out on its own: meta refresh (it navigates
 * after the page loads) and every <link> (prefetch, preconnect and DNS
 * prefetch skip request interception; email apps ignore <link> anyway).
 */
export function prepareHtml(html, images) {
  let out = html
    .replace(/<meta\b[^<>]*http-equiv\s*=\s*["']?refresh[^<>]*>/gi, '')
    .replace(/<link\b[^<>]*>/gi, '')
  // Longest first, so a reference that contains another is replaced whole.
  for (const { ref, url } of [...images].sort(
    (a, b) => b.ref.length - a.ref.length
  ))
    out = out.split(ref).join(url)
  return out
}

/** The only origins a job may load from: its own signed links. */
export function allowedOrigins(job) {
  return new Set(
    [job.html, ...job.images.map((i) => i.url)].map((u) => new URL(u).origin)
  )
}

/** The whole page's size, also when the email's CSS says height:100%. */
async function contentSize(page) {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { cssContentSize } = await cdp.send('Page.getLayoutMetrics')
    return cssContentSize
  } finally {
    await cdp.detach().catch(() => {})
  }
}

/** Renders one job and returns the JPEG and its size. */
export async function render(browser, job, html) {
  const origins = allowedOrigins(job)
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    deviceScaleFactor: 1,
    // A desktop page at 600px. Mobile mode would lay out a page without a
    // viewport tag at 980px.
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: false,
    serviceWorkers: 'block'
  })
  try {
    const page = await context.newPage()
    await page.route('**/*', (route) => {
      const request = route.request()
      const url = request.url()
      // The page itself is set below; it may never go anywhere else.
      if (request.isNavigationRequest()) return route.abort()
      if (url.startsWith('data:')) return route.continue()
      let origin = ''
      try {
        origin = new URL(url).origin
      } catch {
        // An unreadable link is blocked like any other.
      }
      return origins.has(origin) ? route.continue() : route.abort()
    })
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    if (page.url() !== 'about:blank') throw new Error('navigated')
    const size = await contentSize(page)
    const full = {
      width: Math.min(Math.max(width, Math.ceil(size.width)), maxWidth),
      height: Math.min(Math.max(1, Math.ceil(size.height)), maxHeight)
    }
    const shoot = (quality) =>
      page.screenshot({
        type: 'jpeg',
        quality,
        fullPage: true,
        clip: { x: 0, y: 0, ...full },
        timeout: 30_000
      })
    let image = await shoot(80)
    if (image.byteLength > maxBytes) image = await shoot(50)
    if (image.byteLength > maxBytes) throw new Error('too_large')
    return { image, ...full }
  } finally {
    await context.close()
  }
}

async function call(base, secret, init = {}) {
  const response = await fetch(`${base}/api/internal/inbox/screenshots`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
      ...init.headers
    }
  })
  if (!response.ok) throw new Error(`The app answered ${response.status}.`)
  return response.json()
}

/** One run: one job at a time, until none is left (at most `perRun`). */
export async function run({ base, secret, browser, log = console.log }) {
  const counts = { taken: 0, failed: 0 }
  for (let n = 0; n < perRun; n++) {
    const { jobs } = await call(base, secret)
    if (!jobs.length) break
    for (const job of jobs) {
      // A report that does not arrive (for example a lease that ran out)
      // leaves the job for the next run; it never stops this one.
      const report = (body) =>
        call(base, secret, {
          method: 'POST',
          body: JSON.stringify({ job: job.job, lease: job.lease, ...body })
        }).catch(() => null)
      let html
      try {
        const got = await fetch(job.html, {
          signal: AbortSignal.timeout(20_000)
        })
        if (!got.ok) throw new Error('html')
        html = prepareHtml(await got.text(), job.images)
      } catch {
        counts.failed++
        await report({ failure: 'html_unreadable' })
        continue
      }
      let shot
      try {
        shot = await render(browser, job, html)
      } catch {
        counts.failed++
        await report({ failure: 'render_failed' })
        continue
      }
      const uploaded = await fetch(job.upload, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg', 'x-upsert': 'true' },
        body: shot.image,
        signal: AbortSignal.timeout(60_000)
      }).catch(() => null)
      if (!uploaded?.ok) {
        counts.failed++
        await report({ failure: 'upload_failed' })
        continue
      }
      if (await report({ width: shot.width, height: shot.height }))
        counts.taken++
      else counts.failed++
    }
  }
  log(`Screenshots taken: ${counts.taken}. Failed: ${counts.failed}.`)
  return counts
}

/**
 * Chromium parses strangers' HTML and images: it gets no secret in its
 * environment, and its own sandbox where the machine allows one.
 */
export async function launch(chromium) {
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }
  try {
    return await chromium.launch({ chromiumSandbox: true, env })
  } catch {
    return chromium.launch({ env })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const base = (process.env.APP_URL ?? '').replace(/\/+$/, '')
  const secret = process.env.CRON_SECRET ?? ''
  if (!/^https?:\/\//.test(base) || secret.length < 32) {
    console.error('Set APP_URL and CRON_SECRET (see the script header).')
    process.exit(1)
  }
  const { chromium } = await import('@playwright/test')
  const browser = await launch(chromium)
  try {
    await run({ base, secret, browser })
  } catch (error) {
    console.error(`Screenshot run stopped: ${error.message}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}
