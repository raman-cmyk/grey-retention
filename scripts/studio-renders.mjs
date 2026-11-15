/**
 * DST-001c: the section browser job (D25, AGENT_MAP §4 layer 3, step 4).
 * A server function cannot run a browser, so this script does, on a
 * scheduled GitHub Actions runner (.github/workflows/studio-renders.yml):
 * it asks the live app for designed sections to draw
 * (`/api/internal/studio/renders`, with CRON_SECRET), draws each with
 * `renderSection` (scripts/section-render.mjs: JavaScript off, only the
 * section's own origins, no redirect, no navigation), uploads the JPEG
 * through the section's signed link and reports the result.
 *
 * The repository is public, so its logs are: it prints counts only, never
 * a job, a page, a link or the secret, and Chromium gets no secret in its
 * environment.
 *
 * APP_URL=https://… CRON_SECRET=… node scripts/studio-renders.mjs
 */
import { pathToFileURL } from 'node:url'
import { renderSection } from './section-render.mjs'

/** Sections drawn per run at most, and the run's time (the job's limit is longer). */
export const perRun = 24
export const runBudgetMs = 12 * 60_000
/** What the browser may report; refusing a section is the app's decision. */
const reasons = new Set(['timeout', 'failed', 'navigated', 'too_large'])

async function call(base, secret, init = {}) {
  const response = await fetch(`${base}/api/internal/studio/renders`, {
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

/** Uploads one picture through its signed link (the bucket takes JPEG only). */
async function upload(url, image) {
  const response = await fetch(url, {
    method: 'PUT',
    body: image,
    signal: AbortSignal.timeout(60_000),
    headers: { 'content-type': 'image/jpeg', 'x-upsert': 'true' }
  })
  if (!response.ok) throw new Error('upload_failed')
}

/** Draws and uploads one section; the report for the app. */
async function draw(browser, job) {
  const at = { job: job.job, lease: job.lease }
  let drawn
  try {
    drawn = await renderSection(browser, {
      document: job.document,
      height: job.height,
      origins: job.origins
    })
  } catch (error) {
    const reason = String(error?.message ?? '')
    return { ...at, failure: reasons.has(reason) ? reason : 'failed' }
  }
  try {
    await upload(job.upload, drawn.image)
  } catch {
    return { ...at, failure: 'upload_failed' }
  }
  return { ...at, height: drawn.height, bytes: drawn.image.byteLength }
}

/** One run: one section at a time, until none is left (at most `perRun`, `runBudgetMs`). */
export async function run({
  base,
  secret,
  browser,
  log = console.log,
  now = Date.now
}) {
  const counts = { drawn: 0, failed: 0 }
  const until = now() + runBudgetMs
  for (let n = 0; n < perRun && now() < until; n++) {
    const answer = await call(base, secret)
    const jobs = Array.isArray(answer?.jobs) ? answer.jobs : []
    if (!jobs.length) break
    for (const job of jobs) {
      const report = await draw(browser, job)
      // A report that does not arrive leaves the job to its lease: the
      // next run draws it again.
      await call(base, secret, {
        method: 'POST',
        body: JSON.stringify(report)
      }).catch(() => null)
      if ('failure' in report) counts.failed++
      else counts.drawn++
    }
  }
  log(`Sections drawn: ${counts.drawn}. Failed: ${counts.failed}.`)
  return counts
}

/**
 * Chromium draws pages built from strangers' words and pictures: it gets
 * no secret in its environment, and its own sandbox where the machine
 * allows one (as the inbox screenshots).
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
  // CI-005: a pasted secret's line breaks are not part of it.
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
    // Never the secret, even inside an error's words.
    const words = String(error?.message ?? error)
      .split(secret)
      .join('[secret]')
      .slice(0, 300)
    console.error(`Render run stopped: ${words}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}
