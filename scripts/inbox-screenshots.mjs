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
 *
 * INB-002b: like the designed-section browser (DST-001), it never follows
 * a redirect: an allowed address that redirects is refused, so nothing
 * reaches another host or a private address through it; the email and the
 * uploads are fetched the same way. What skips the route guard (a <link>
 * prefetch, a <meta> refresh, a <base>) is made inert before the page is
 * drawn. The printed counts include how many of the job's own pictures or
 * styles were refused or failed (a storage that starts redirecting shows
 * there instead of silently dropping every picture).
 */
import { pathToFileURL } from 'node:url'
import { launch, loadableOrigins, makeInert } from '../lib/sandbox/browser.mjs'

/** How Chromium is launched (`lib/sandbox/browser.mjs`). */
export { launch }

export const width = 600
export const maxWidth = 2000
export const maxHeight = 16000
/** The bucket takes 10 MiB; stay under it. */
export const maxBytes = 9.5 * 1024 * 1024
/** Emails photographed per run at most. */
export const perRun = 20
/**
 * A job's lease lasts two minutes: section crops stop after 70 seconds and
 * their uploads after 90, so the report always arrives in time. Sections
 * left out simply have no crop.
 */
export const cropBudgetMs = 70_000
export const uploadBudgetMs = 90_000

/**
 * Puts each stored image in place of the reference the HTML uses, and
 * makes inert what would reach out on its own (`makeInert`).
 */
export function prepareHtml(html, images) {
  let out = makeInert(html)
  // Longest first, so a reference that contains another is replaced whole.
  for (const { ref, url } of [...images].sort(
    (a, b) => b.ref.length - a.ref.length
  ))
    out = out.split(ref).join(url)
  return out
}

/**
 * The only origins a job may load from: its own signed links, https only
 * (loopback http for tests), as the designed-section browser allows.
 */
export function allowedOrigins(job) {
  return loadableOrigins(
    [job.html, ...job.images.map((i) => i.url)].map((u) => new URL(u).origin)
  )
}

/** A redirect is an error: the address asked for is the one answered. */
const once = { redirect: 'error' }
/**
 * How long one picture or style may take (`loadMs`) and the whole page
 * (`pageMs`); tests pass shorter ones.
 */
export const timing = { loadMs: 20_000, pageMs: 30_000 }
/** A route answered after its page closed: nothing is left to tell. */
const quietly = (answer) => answer.catch(() => {})

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

/**
 * INB-003: one picture per section. A section is every element marked
 * with its number (one row, or a few paragraphs); its box is the area
 * around all of them, inside the whole picture.
 */
async function crops(page, job, full, until) {
  const out = []
  for (const { ordinal } of job.sections ?? []) {
    if (Date.now() > until) break
    const boxes = []
    for (const el of await page
      .locator(`[data-gr-section="${ordinal}"]`)
      .all()) {
      const box = await el.boundingBox()
      if (box && box.height > 0) boxes.push(box)
    }
    if (!boxes.length) continue
    const top = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.y))))
    const bottom = Math.min(
      full.height,
      Math.ceil(Math.max(...boxes.map((b) => b.y + b.height)))
    )
    if (bottom <= top) continue
    const image = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      fullPage: true,
      clip: { x: 0, y: top, width: full.width, height: bottom - top },
      timeout: 30_000
    })
    if (image.byteLength <= maxBytes)
      out.push({ ordinal, top, height: bottom - top, image })
  }
  return out
}

/** Renders one job and returns the JPEG, its size and its section crops. */
export async function render(
  browser,
  job,
  html,
  until = Date.now() + cropBudgetMs,
  { loadMs, pageMs } = timing
) {
  const origins = allowedOrigins(job)
  // The job's own pictures and styles refused (a redirect) or failed.
  let unloaded = 0
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
    await page.route('**/*', async (route) => {
      const request = route.request()
      const url = request.url()
      // The page itself is set below; it may never go anywhere else.
      if (request.isNavigationRequest()) return quietly(route.abort())
      if (url.startsWith('data:')) return quietly(route.continue())
      let origin = ''
      try {
        origin = new URL(url).origin
      } catch {
        // An unreadable link is blocked like any other.
      }
      if (!origins.has(origin)) return quietly(route.abort())
      // The browser would follow a redirect without asking again (the
      // route sees only the first address): fetch it here, never following
      // one, and refuse an answer that redirects.
      try {
        const response = await route.fetch({
          maxRedirects: 0,
          timeout: loadMs
        })
        if (response.status() >= 300 && response.status() < 400) {
          unloaded++
          return quietly(route.abort())
        }
        return quietly(route.fulfill({ response }))
      } catch {
        unloaded++
        return quietly(route.abort())
      }
    })
    await page.setContent(html, { waitUntil: 'load', timeout: pageMs })
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
    return {
      image,
      ...full,
      sections: await crops(page, job, full, until),
      unloaded
    }
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
export async function run({
  base,
  secret,
  browser,
  log = console.log,
  times = timing
}) {
  const counts = { taken: 0, failed: 0, unloaded: 0 }
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
      const started = Date.now()
      let html
      try {
        const got = await fetch(job.html, {
          ...once,
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
        shot = await render(browser, job, html, started + cropBudgetMs, times)
        counts.unloaded += shot.unloaded
      } catch {
        counts.failed++
        await report({ failure: 'render_failed' })
        continue
      }
      const uploaded = await fetch(job.upload, {
        ...once,
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
      // Section crops that do not upload are simply not reported.
      const boxes = []
      for (const crop of shot.sections) {
        const left = started + uploadBudgetMs - Date.now()
        if (left < 1_000) break
        const target = job.sections.find((s) => s.ordinal === crop.ordinal)
        const put = target
          ? await fetch(target.upload, {
              ...once,
              method: 'PUT',
              headers: { 'content-type': 'image/jpeg', 'x-upsert': 'true' },
              body: crop.image,
              signal: AbortSignal.timeout(Math.min(20_000, left))
            }).catch(() => null)
          : null
        if (put?.ok)
          boxes.push({
            ordinal: crop.ordinal,
            top: crop.top,
            height: crop.height
          })
      }
      if (await report({ width: shot.width, height: shot.height, boxes }))
        counts.taken++
      else counts.failed++
    }
  }
  log(
    `Screenshots taken: ${counts.taken}. Failed: ${counts.failed}. Stored pictures or styles refused or failed: ${counts.unloaded}.`
  )
  return counts
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const base = (process.env.APP_URL ?? '').replace(/\/+$/, '')
  // CI-005: a pasted secret's line breaks are not part of it (as in the
  // workflow's own call).
  const secret = (process.env.CRON_SECRET ?? '').replace(/[\r\n]/g, '').trim()
  if (!/^https?:\/\//.test(base) || secret.length < 32) {
    console.error('Set APP_URL and CRON_SECRET (see the script header).')
    process.exit(1)
  }
  const { chromium } = await import('@playwright/test')
  const browser = await launch(chromium)
  try {
    await run({ base, secret, browser })
  } catch (error) {
    // Never the secret, even inside an error's words (a header error
    // quotes the header).
    const words = String(error?.message ?? error)
      .split(secret)
      .join('[secret]')
      .slice(0, 300)
    console.error(`Screenshot run stopped: ${words}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}
