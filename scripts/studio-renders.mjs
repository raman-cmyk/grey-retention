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
 * Then the built emails' views waiting (DST-005b: desktop, phone, dark)
 * are drawn the same way with `renderEmail`, from
 * `/api/internal/studio/previews`. Then the design steps waiting for their
 * pictures go on (`carryOn`, DST-006b).
 *
 * The repository is public, so its logs are: it prints counts only, never
 * a job, a page, a link or the secret, and Chromium gets no secret in its
 * environment.
 *
 * APP_URL=https://… CRON_SECRET=… node scripts/studio-renders.mjs
 */
import { pathToFileURL } from 'node:url'
import { renderEmail, renderSection } from './section-render.mjs'
import { fetchCrop, lumaGrid } from './luma-grid.mjs'

/**
 * Pictures drawn per run at most (sections and views together), and the
 * run's time: with the setup before it (the two peeks, each with its
 * 2-minute retry, and installing Chromium), one last picture and the
 * designs carried on after (`carryOnMs`), a run ends inside the job's 18
 * minutes. A picture takes seconds: 24 fit well inside 6 minutes.
 */
export const perRun = 24
export const runBudgetMs = 6 * 60_000
/** A job's lease (`claim_platform_job`); its report must arrive inside it. */
export const leaseMs = 120_000
/** Time kept at the end of the lease for the report. */
const reportMs = 15_000
/** The lease time the grids need (both pictures read, the crop fetched). */
export const gridsMs = 30_000
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

/**
 * What the app hands out, how each is drawn, and what is reported: a
 * designed section (DST-001b) or a view of a built email (DST-005b).
 */
const kinds = {
  section: {
    path: '/api/internal/studio/renders',
    draw: (browser, job) =>
      renderSection(browser, {
        document: job.document,
        height: job.height,
        origins: job.origins
      }),
    report: (drawn) => ({
      height: drawn.height,
      bytes: drawn.image.byteLength
    }),
    // DST-004b2c: the match score's grids, when they can be read in time.
    grids: async (browser, job, drawn, left) => {
      if (left() < gridsMs) return {}
      const grid = await lumaGrid(browser, drawn.image)
      if (!grid) return {}
      if (!job.reference || left() < gridsMs) return { grid }
      const crop = await fetchCrop(job.reference).catch(() => null)
      const referenceGrid = crop ? await lumaGrid(browser, crop) : null
      return referenceGrid ? { grid, referenceGrid } : { grid }
    }
  },
  view: {
    path: '/api/internal/studio/previews',
    draw: (browser, job) =>
      renderEmail(browser, {
        document: job.document,
        view: job.view,
        origins: job.origins
      }),
    report: (drawn) => ({
      height: drawn.height,
      cut: drawn.cut,
      wide: drawn.wide,
      bytes: drawn.image.byteLength
    })
  }
}

/** Draws and uploads one picture inside its lease; the report for the app. */
async function draw(browser, kind, job, leaseLeft) {
  const at = { job: job.job, lease: job.lease }
  let drawn
  try {
    drawn = await kind.draw(browser, job)
  } catch (error) {
    const reason = String(error?.message ?? '')
    return { ...at, failure: reasons.has(reason) ? reason : 'failed' }
  }
  try {
    await upload(job.upload, drawn.image, leaseLeft() - reportMs)
  } catch {
    return { ...at, failure: 'upload_failed' }
  }
  // The grids are extra: without them the picture is still reported.
  const grids = kind.grids
    ? await kind
        .grids(browser, job, drawn, () => leaseLeft() - reportMs)
        .catch(() => ({}))
    : {}
  return { ...at, ...kind.report(drawn), ...grids }
}

/**
 * One run: one picture at a time, the sections first, then the email's
 * views, until none is left (at most `perRun` together, `runBudgetMs`). A
 * picture counts as drawn only when the app recorded it; a report that did
 * not arrive leaves the job to its lease (it is drawn again once the lease
 * runs out). A browser that stopped ends the run, so the pictures waiting
 * never spend their attempts on it.
 */
export async function run({
  base,
  secret,
  browser,
  log = console.log,
  now = Date.now
}) {
  const counts = { drawn: 0, failed: 0, lost: 0 }
  const views = { drawn: 0, failed: 0, lost: 0 }
  // DST-004b2c: the grids read with the sections recorded (counts only).
  const grids = { read: 0, reference: 0, asked: 0 }
  const until = now() + runBudgetMs
  const alive = () => !browser.isConnected || browser.isConnected()
  let n = 0
  try {
    for (const [kind, tally] of [
      [kinds.section, counts],
      [kinds.view, views]
    ])
      for (; n < perRun && now() < until; n++) {
        if (!alive()) throw new Error('The browser stopped.')
        const answer = await call(base, secret, {}, kind.path)
        const claimed = now()
        const jobs = Array.isArray(answer?.jobs) ? answer.jobs : []
        if (!jobs.length) break
        for (const job of jobs) {
          const report = await draw(
            browser,
            kind,
            job,
            () => leaseMs - (now() - claimed)
          )
          // The browser died while drawing: nothing is reported, the lease
          // brings the picture back, and the run ends.
          if ('failure' in report && !alive())
            throw new Error('The browser stopped.')
          const recorded = await call(
            base,
            secret,
            { method: 'POST', body: JSON.stringify(report) },
            kind.path
          ).then(
            () => true,
            () => false
          )
          if (!recorded) tally.lost++
          else if ('failure' in report) tally.failed++
          else {
            tally.drawn++
            if (kind === kinds.section) {
              if (report.grid) grids.read++
              if (job.reference) grids.asked++
              if (report.referenceGrid) grids.reference++
            }
          }
        }
      }
  } finally {
    log(
      `Sections drawn: ${counts.drawn}. Failed: ${counts.failed}. Not recorded: ${counts.lost}.`
    )
    log(
      `Email views drawn: ${views.drawn}. Failed: ${views.failed}. Not recorded: ${views.lost}.`
    )
    log(
      `Grids read: ${grids.read}. Reference grids read: ${grids.reference} of ${grids.asked}.`
    )
  }
  return { ...counts, views }
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
  // Never the secret, even inside an error's words.
  const words = (error) =>
    String(error?.message ?? error)
      .split(secret)
      .join('[secret]')
      .slice(0, 300)
  try {
    await run({ base, secret, browser })
  } catch (error) {
    console.error(`Render run stopped: ${words(error)}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
  // The pictures drawn before a stop still carry their designs on.
  try {
    await carryOn({ base, secret })
  } catch (error) {
    console.error(`Designs not carried on: ${words(error)}`)
    process.exitCode = 1
  }
}
