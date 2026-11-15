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
 * Then the design steps waiting for their pictures go on (`carryOn`,
 * DST-006b).
 *
 * The repository is public, so its logs are: it prints counts only, never
 * a job, a page, a link or the secret, and Chromium gets no secret in its
 * environment.
 *
 * APP_URL=https://… CRON_SECRET=… node scripts/studio-renders.mjs
 */
import { pathToFileURL } from 'node:url'
import { renderSection } from './section-render.mjs'

/**
 * Sections drawn per run at most, and the run's time: with the setup
 * before it (the peek and its retry, installing Chromium) and one last
 * section, a run ends well inside the job's 18 minutes.
 */
export const perRun = 24
export const runBudgetMs = 8 * 60_000
/** A job's lease (`claim_platform_job`); its report must arrive inside it. */
export const leaseMs = 120_000
/** Time kept at the end of the lease for the report. */
const reportMs = 15_000
/** What the browser may report; refusing a section is the app's decision. */
const reasons = new Set(['timeout', 'failed', 'navigated', 'too_large'])

async function call(
  base,
  secret,
  init = {},
  path = '/api/internal/studio/renders',
  ms = 30_000
) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    // The secret goes to the app only, never on through a redirect.
    redirect: 'error',
    signal: AbortSignal.timeout(ms),
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
async function upload(url, image, ms) {
  if (!/^https:\/\//.test(url) || ms < 1_000) throw new Error('upload_failed')
  const response = await fetch(url, {
    method: 'PUT',
    body: image,
    redirect: 'error',
    signal: AbortSignal.timeout(Math.min(60_000, ms)),
    headers: { 'content-type': 'image/jpeg', 'x-upsert': 'true' }
  })
  if (!response.ok) throw new Error('upload_failed')
}

/** Draws and uploads one section inside its lease; the report for the app. */
async function draw(browser, job, leaseLeft) {
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
    await upload(job.upload, drawn.image, leaseLeft() - reportMs)
  } catch {
    return { ...at, failure: 'upload_failed' }
  }
  return { ...at, height: drawn.height, bytes: drawn.image.byteLength }
}

/**
 * One run: one section at a time, until none is left (at most `perRun`,
 * `runBudgetMs`). A section counts as drawn only when the app recorded it;
 * a report that did not arrive leaves the job to its lease (it is drawn
 * again once the lease runs out). A browser that stopped ends the run, so
 * the sections waiting never spend their attempts on it.
 */
export async function run({
  base,
  secret,
  browser,
  log = console.log,
  now = Date.now
}) {
  const counts = { drawn: 0, failed: 0, lost: 0 }
  const until = now() + runBudgetMs
  const alive = () => !browser.isConnected || browser.isConnected()
  try {
    for (let n = 0; n < perRun && now() < until; n++) {
      if (!alive()) throw new Error('The browser stopped.')
      const answer = await call(base, secret)
      const claimed = now()
      const jobs = Array.isArray(answer?.jobs) ? answer.jobs : []
      if (!jobs.length) break
      for (const job of jobs) {
        const report = await draw(
          browser,
          job,
          () => leaseMs - (now() - claimed)
        )
        // The browser died while drawing: nothing is reported, the lease
        // brings the section back, and the run ends.
        if ('failure' in report && !alive())
          throw new Error('The browser stopped.')
        const recorded = await call(base, secret, {
          method: 'POST',
          body: JSON.stringify(report)
        }).then(
          () => true,
          () => false
        )
        if (!recorded) counts.lost++
        else if ('failure' in report) counts.failed++
        else counts.drawn++
      }
    }
  } finally {
    log(
      `Sections drawn: ${counts.drawn}. Failed: ${counts.failed}. Not recorded: ${counts.lost}.`
    )
  }
  return counts
}

/**
 * DST-006b: after drawing, the design steps waiting for their pictures go
 * on (`/api/internal/studio/builds`, the design studio's job, with the
 * agents, only with the owner's switches on). It logs a count only.
 */
export async function carryOn({ base, secret, log = console.log }) {
  const answer = await call(
    base,
    secret,
    {},
    '/api/internal/studio/builds',
    carryOnMs
  )
  const builds = Number.isInteger(answer?.builds) ? answer.builds : 0
  log(answer?.off ? 'Design studio off.' : `Designs carried on: ${builds}.`)
  return builds
}
/** The design studio's job runs for up to 2 minutes. */
export const carryOnMs = 130_000

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
    await carryOn({ base, secret })
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
