#!/usr/bin/env node
/**
 * DES-ENGINE-002: the Inspiration blueprint browser. The scheduled inbox
 * browser job (.github/workflows/inbox-screenshots.yml) runs it after the
 * screenshots; it can also run on a developer machine against the local
 * app.
 *
 *   APP_URL=https://… CRON_SECRET=… \
 *     node --import ./scripts/ts-register.mjs scripts/inbox-blueprints.mjs
 *
 * It asks the app for one email at a time (its marked HTML and its stored
 * pictures, as short-lived signed links), measures it with the design
 * engine in the same locked browser the screenshots use (JavaScript off,
 * only the email's own stored pictures' origins, no redirect, no
 * navigation), drops every picture address and link (`measureForStorage`)
 * and reports the blueprint. An email that can never be measured is
 * reported with its reason; a slow browser is tried again by a later run.
 * It prints counts only: never a link, an email or the secret.
 */
import { pathToFileURL } from 'node:url'
import { launch, loadableOrigins } from '../lib/sandbox/browser.mjs'
import { prepareHtml } from './inbox-screenshots.mjs'

/** Emails measured per run at most. */
export const perRun = 30
/**
 * A run's time: with the screenshots before it, the whole job ends well
 * inside its 30 minutes (each email's lease is 2 minutes).
 */
export const runBudgetMs = 5 * 60_000

/** The origins a job's pictures may load from (its own signed links). */
export function pictureOrigins(job) {
  return [...loadableOrigins(job.images.map((i) => new URL(i.url).origin))]
}

async function call(base, secret, init = {}, query = '') {
  const response = await fetch(
    `${base}/api/internal/inbox/blueprints${query}`,
    {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
        ...init.headers
      }
    }
  )
  if (!response.ok) throw new Error(`The app answered ${response.status}.`)
  return response.json()
}

/** One run: one email at a time until none is left (at most `perRun`). */
export async function run({
  base,
  secret,
  browser,
  log = console.log,
  measure,
  engine,
  now = Date.now
}) {
  const stored =
    measure && engine
      ? null
      : await import('../features/design-engine/stored.ts')
  const measureFor = measure ?? stored.measureForStorage
  // The app tries a job again when it runs another engine version.
  const version = engine ?? stored.ENGINE_VERSION
  const counts = { measured: 0, failed: 0, retry: 0, skew: false }
  const until = now() + runBudgetMs
  for (let n = 0; n < perRun && now() < until; n++) {
    const { jobs, skew } = await call(
      base,
      secret,
      {},
      `?engine=${encodeURIComponent(version)}`
    )
    if (skew) counts.skew = true
    if (!jobs.length) break
    for (const job of jobs) {
      const report = (body) =>
        call(base, secret, {
          method: 'POST',
          body: JSON.stringify({ job: job.job, lease: job.lease, ...body })
        }).catch(() => null)
      let html
      try {
        const got = await fetch(job.html, {
          redirect: 'error',
          signal: AbortSignal.timeout(20_000)
        })
        if (!got.ok) throw new Error('html')
        html = prepareHtml(await got.text(), job.images)
      } catch {
        counts.retry++
        await report({ retry: 'html_unreadable' })
        continue
      }
      const measured = await measureFor(browser, html, pictureOrigins(job))
      if (measured.ok) {
        if (await report({ engine: version, blueprint: measured.blueprint }))
          counts.measured++
        else counts.retry++
      } else if (measured.retry) {
        counts.retry++
        await report({ retry: measured.failure })
      } else {
        counts.failed++
        await report({ engine: version, failure: measured.failure })
      }
    }
  }
  log(
    `Blueprints measured: ${counts.measured}. Cannot be measured: ${counts.failed}. To try again: ${counts.retry}.${counts.skew ? ' The app runs another engine version: nothing was measured; the next run tries again.' : ''}`
  )
  return counts
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const base = (process.env.APP_URL ?? '').replace(/\/+$/, '')
  const secret = (process.env.CRON_SECRET ?? '').replace(/[\r\n]/g, '').trim()
  if (!/^https?:\/\//.test(base) || secret.length < 32) {
    console.error('Set APP_URL and CRON_SECRET (see the script header).')
    process.exit(1)
  }
  const { chromium } = await import('@playwright/test')
  const browser = await launch(chromium)
  try {
    const counts = await run({ base, secret, browser })
    // A version mismatch that lasts past a deploy must be seen, not just
    // printed: the run is marked and turns red.
    if (counts.skew) {
      console.log(
        '::warning::The app runs another design engine version than this job; no blueprint was measured. Deploy both from the same commit.'
      )
      process.exitCode = 1
    }
  } catch (error) {
    const words = String(error?.message ?? error)
      .split(secret)
      .join('[secret]')
      .slice(0, 300)
    console.error(`Blueprint run stopped: ${words}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}
