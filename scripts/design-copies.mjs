#!/usr/bin/env node
/**
 * DES-ENGINE-002b2: the library copy browser ("Use this design" with Copy).
 * The scheduled job (.github/workflows/design-copies.yml) runs it; it can
 * also run on a developer machine against the local app.
 *
 *   APP_URL=https://… CRON_SECRET=… \
 *     node --import ./scripts/ts-register.mjs scripts/design-copies.mjs
 *
 * It asks the app for one copy at a time (what the build saved for it, the
 * inspiration email's stored blueprint, its marked HTML as a short-lived
 * signed link, signed upload links for the cut photos and the server's
 * fixed list of photo hosts), runs the design engine's `libraryCopy` in
 * the same locked browser the other jobs use (JavaScript off, no request
 * but the photos the server fetched itself from that fixed list), uploads
 * the cut photos to the private bucket and reports the copy. Then it asks
 * the app to take the builds whose copies are in through their checks and
 * into Klaviyo as drafts. It prints counts only: never a link, an email,
 * a brand's words or the secret.
 */
import { pathToFileURL } from 'node:url'
import { launch } from '../lib/sandbox/browser.mjs'

/** Copies made per run at most. */
export const perRun = 10
/** A run's time, inside the job's 20 minutes. */
export const runBudgetMs = 12 * 60_000
/** One copy's time, inside its 10-minute lease (the report needs a moment). */
export const copyBudgetMs = 8 * 60_000

const loopback = (u) =>
  u.protocol === 'http:' &&
  (u.hostname === '127.0.0.1' || u.hostname === 'localhost')

/** An https link (or a loopback one, for a local run). */
export function linkOk(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || loopback(u)
  } catch {
    return false
  }
}

/** The hosts photos may come from: the server's list, https origins only. */
export function photoHosts(origins) {
  return (Array.isArray(origins) ? origins : []).flatMap((o) => {
    try {
      const u = new URL(String(o))
      return u.protocol === 'https:' && u.origin === String(o) ? [u.origin] : []
    } catch {
      return []
    }
  })
}

/** A section's outcome as the email's page tells it. */
export const sectionOf = (s) => ({
  ordinal: s.ordinal,
  kind: s.kind,
  result: s.result,
  reason:
    s.result === 'copied'
      ? null
      : ((s.fallback?.reason ?? null)?.slice(0, 600) ?? null)
})

/** Resolves `work`, or rejects with `timeout` after `ms`. */
function within(work, ms) {
  let timer
  return Promise.race([
    work,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

async function call(base, secret, init = {}, query = '') {
  const response = await fetch(`${base}/api/internal/design/copies${query}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(init.timeout ?? 30_000),
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
      ...init.headers
    }
  })
  if (!response.ok) throw new Error(`The app answered ${response.status}.`)
  return response.json()
}

/** Uploads one cut photo (an inline JPEG) to its signed link. */
export async function upload(url, inline, fetchImpl = fetch) {
  const m = /^data:image\/jpeg;base64,([a-z0-9+/]+={0,2})$/i.exec(inline)
  if (!m || !linkOk(url)) throw new Error('upload_failed')
  const response = await fetchImpl(url, {
    method: 'PUT',
    body: Buffer.from(m[1], 'base64'),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
    headers: { 'content-type': 'image/jpeg', 'x-upsert': 'true' }
  })
  if (!response.ok) throw new Error('upload_failed')
}

/** One run: one copy at a time until none is left (at most `perRun`). */
export async function run({
  base,
  secret,
  browser,
  log = console.log,
  copy,
  tools,
  engine,
  send = upload,
  now = Date.now
}) {
  const engineMods =
    copy && engine && tools
      ? null
      : await Promise.all([
          import('../features/design-engine/library-copy.ts'),
          import('../features/design-engine/photos.ts'),
          import('../features/design-engine/stored.ts')
        ])
  const copyFor = copy ?? engineMods[0].libraryCopy
  const toolsFor =
    tools ?? ((origins) => engineMods[1].photoTools(browser, { origins }))
  const version = engine ?? engineMods[2].ENGINE_VERSION
  const counts = { copied: 0, failed: 0, retry: 0, skew: false, carried: 0 }
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
      let sourceHtml
      try {
        if (!linkOk(job.html)) throw new Error('html')
        const got = await fetch(job.html, {
          redirect: 'error',
          signal: AbortSignal.timeout(20_000)
        })
        if (!got.ok) throw new Error('html')
        sourceHtml = await got.text()
      } catch {
        counts.retry++
        await report({ retry: 'html_unreadable' })
        continue
      }
      const input = job.input
      let made
      try {
        made = await within(
          copyFor(browser, {
            source: job.source,
            sourceHtml,
            sourceNames: input.sourceNames,
            brand: input.brand,
            products: input.products,
            words: input.words,
            rules: input.rules,
            vocabulary: input.vocabulary,
            mode: input.mode,
            crop: 'canvas',
            // Photos only from the server's fixed list (never the input's).
            tools: toolsFor(photoHosts(job.origins))
          }),
          copyBudgetMs
        )
      } catch {
        counts.retry++
        await report({ retry: 'timeout' })
        continue
      }
      if (!made.ok) {
        counts.failed++
        await report({ engine: version, failure: 'copy_failed' })
        continue
      }
      const uploads = new Map(job.uploads.map((u) => [u.index, u.url]))
      if (made.cuts.length > uploads.size) {
        counts.failed++
        await report({ engine: version, failure: 'too_many_photos' })
        continue
      }
      const photos = []
      try {
        for (const [index, cut] of made.cuts.entries()) {
          await send(uploads.get(index), cut.inline)
          photos.push(index)
        }
      } catch {
        counts.retry++
        await report({ retry: 'upload_failed' })
        continue
      }
      const done = await report({
        engine: version,
        record: {
          html: made.html,
          sections: made.sections.map(sectionOf),
          pass: made.pass,
          leaks: made.leaks.map((l) => ({
            kind: l.kind,
            value: String(l.value).slice(0, 200)
          })),
          footerAdded: made.footerAdded,
          photos
        }
      })
      if (done) counts.copied++
      else counts.retry++
    }
  }
  if (counts.copied || counts.failed) {
    const carried = await call(
      base,
      secret,
      { timeout: 130_000 },
      '?carry=1'
    ).catch(() => null)
    counts.carried = Number(carried?.builds) || 0
  }
  log(
    `Copies made: ${counts.copied}. Cannot be copied: ${counts.failed}. To try again: ${counts.retry}. Emails carried on: ${counts.carried}.${counts.skew ? ' The app runs another engine version: nothing was copied; the next run tries again.' : ''}`
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
        '::warning::The app runs another design engine version than this job; no email was copied. Deploy both from the same commit.'
      )
      process.exitCode = 1
    }
  } catch (error) {
    const words = String(error?.message ?? error)
      .split(secret)
      .join('[secret]')
      .slice(0, 300)
    console.error(`Copy run stopped: ${words}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}
