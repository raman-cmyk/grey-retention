#!/usr/bin/env node
/**
 * DES-ENGINE-004: the block library's browser. The scheduled design
 * copies job (.github/workflows/design-copies.yml) runs it after the
 * uploads; it can also run on a developer machine against the local app.
 *
 *   APP_URL=https://… CRON_SECRET=… \
 *     node --import ./scripts/ts-register.mjs scripts/design-blocks.mjs
 *
 * It asks the app for one source at a time (an Inspiration email's or an
 * upload's sections whose structure the library does not have yet, each
 * as a section on its own: bare, no picture and no link), draws each back
 * with the design engine in the same locked browser every drawing uses
 * (JavaScript off, no request at all) and reports, per section, whether
 * it looks like its source (`checkBlock`). The app cuts and records the
 * blocks itself. It prints counts only: never a section, a word or the
 * secret.
 */
import { pathToFileURL } from 'node:url'
import { launch } from '../lib/sandbox/browser.mjs'

/** Sources per run at most. */
export const perRun = 30
/** A run's time, after the copies and the uploads (each lease is 5 minutes). */
export const runBudgetMs = 4 * 60_000
/**
 * The lease is renewed this often while a long email is drawn (it runs 5
 * minutes from each renewal); a renewal refused (the lease lost, or held
 * 30 minutes) stops the email, and its job is tried again later.
 */
export const renewEveryMs = 2 * 60_000

async function call(base, secret, init = {}, query = '') {
  const response = await fetch(`${base}/api/internal/design/blocks${query}`, {
    ...init,
    redirect: 'error',
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

/** One run: one source at a time until none is left (at most `perRun`). */
export async function run({
  base,
  secret,
  browser,
  log = console.log,
  check,
  engine,
  now = Date.now
}) {
  const loaded =
    check && engine
      ? null
      : {
          ...(await import('../features/design-engine/blocks.ts')),
          ...(await import('../features/design-engine/stored.ts'))
        }
  const checkFor = check ?? loaded.checkBlock
  const version = engine ?? loaded.ENGINE_VERSION
  const counts = { sources: 0, passed: 0, failed: 0, retry: 0, skew: false }
  const until = now() + runBudgetMs
  for (let n = 0; n < perRun && now() < until; n++) {
    const { jobs, skew } = await call(
      base,
      secret,
      {},
      `?engine=${encodeURIComponent(version)}`
    )
    if (skew) {
      counts.skew = true
      break
    }
    if (!jobs?.length) {
      // A source the app recorded itself (nothing new to draw) hands out
      // nothing: ask again while the peek says more wait.
      const peek = await call(base, secret, {}, '?peek=1').catch(() => null)
      if (!Number(peek?.waiting)) break
      continue
    }
    for (const job of jobs) {
      const report = (body) =>
        call(base, secret, {
          method: 'POST',
          body: JSON.stringify({ job: job.job, lease: job.lease, ...body })
        }).catch(() => null)
      const checks = []
      let broken = false
      let lost = false
      let renewed = now()
      let spent = false
      for (const c of job.checks ?? []) {
        // The run's time is spent: the email is handed back (its try given
        // back) and goes on in the next run, never cut by the job's own
        // timeout (a lost lease would cost a try).
        if (now() >= until) {
          spent = true
          break
        }
        if (now() - renewed >= renewEveryMs) {
          if (!(await report({ renew: true }))) {
            lost = true
            break
          }
          renewed = now()
        }
        let got
        try {
          got = await checkFor(browser, c.blueprint)
        } catch {
          broken = true
          break
        }
        checks.push(
          got.pass
            ? { ordinal: c.ordinal, pass: true }
            : { ordinal: c.ordinal, pass: false, failure: got.failure }
        )
        if (got.pass) counts.passed++
        else counts.failed++
      }
      if (lost) {
        counts.retry++
        continue
      }
      if (spent) {
        counts.retry++
        await report({ release: 'run_budget' })
        continue
      }
      if (broken) {
        counts.retry++
        await report({ retry: 'engine_error' })
        continue
      }
      if (await report({ engine: version, checks })) counts.sources++
      else counts.retry++
    }
  }
  log(
    `Library blocks: sources ${counts.sources}, new layouts that pass ${counts.passed}, that do not ${counts.failed}, to try again ${counts.retry}.${counts.skew ? ' The app runs another engine version: nothing was checked; the next run tries again.' : ''}`
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
    if (counts.skew) {
      console.log(
        '::warning::The app runs another design engine version than this job; no block was checked. Deploy both from the same commit.'
      )
      process.exitCode = 1
    }
  } catch (error) {
    const words = String(error?.message ?? error)
      .split(secret)
      .join('[secret]')
      .slice(0, 300)
    console.error(`Block checking stopped: ${words}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}
