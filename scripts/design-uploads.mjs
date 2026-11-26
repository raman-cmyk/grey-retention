#!/usr/bin/env node
/**
 * DES-ENGINE-003: the upload measuring browser. The scheduled design
 * copies job (.github/workflows/design-copies.yml) runs it after the
 * copies; it can also run on a developer machine against the local app.
 *
 *   APP_URL=https://… CRON_SECRET=… \
 *     node --import ./scripts/ts-register.mjs scripts/design-uploads.mjs
 *
 * It asks the app for one uploaded email at a time (its prepared HTML, as
 * a short-lived signed link; every picture in it is already an empty
 * drawing of its own size), measures it with the design engine in the
 * same locked browser every measurement uses (JavaScript off, no request
 * at all, no navigation), keeps what the upload's kind may keep
 * (`features/email-uploads/measure.ts`: another brand's email keeps no
 * picture and no link) and reports the blueprint. An email that can never
 * be measured is reported with its reason; a slow browser is tried again
 * by a later run. It prints counts only: never a link, an email or the
 * secret.
 */
import { pathToFileURL } from 'node:url'
import { launch } from '../lib/sandbox/browser.mjs'

/** Uploads measured per run at most. */
export const perRun = 20
/** A run's time, after the copies (each upload's lease is 5 minutes). */
export const runBudgetMs = 4 * 60_000

async function call(base, secret, init = {}, query = '') {
  const response = await fetch(`${base}/api/internal/design/uploads${query}`, {
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

/** One run: one upload at a time until none is left (at most `perRun`). */
export async function run({
  base,
  secret,
  browser,
  log = console.log,
  measure,
  engine,
  now = Date.now
}) {
  const loaded =
    measure && engine
      ? null
      : {
          ...(await import('../features/email-uploads/measure.ts')),
          ...(await import('../features/design-engine/stored.ts'))
        }
  const measureFor = measure ?? loaded.measureUpload
  const version = engine ?? loaded.ENGINE_VERSION
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
    if (!jobs?.length) break
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
        html = await got.text()
      } catch {
        counts.retry++
        await report({ retry: 'html_unreadable' })
        continue
      }
      const measured = await measureFor(
        browser,
        html,
        job.design === 'other' ? 'other' : 'own',
        Number(job.pictures) || 0
      )
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
    `Uploads measured: ${counts.measured}. Cannot be measured: ${counts.failed}. To try again: ${counts.retry}.${counts.skew ? ' The app runs another engine version: nothing was measured; the next run tries again.' : ''}`
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
        '::warning::The app runs another design engine version than this job; no upload was measured. Deploy both from the same commit.'
      )
      process.exitCode = 1
    }
  } catch (error) {
    const words = String(error?.message ?? error)
      .split(secret)
      .join('[secret]')
      .slice(0, 300)
    console.error(`Upload measuring stopped: ${words}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}
