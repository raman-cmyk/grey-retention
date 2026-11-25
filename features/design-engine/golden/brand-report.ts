import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser } from '@playwright/test'
import { desktopWindow, measureHtml, phoneWindow, pictureOf } from '../browser'
import { copyBlueprint, type CopyResult } from '../copy'
import { leaksOf, type Leak } from '../leaks'
import { blueprintFrom } from '../measure'
import { forStorage } from '../stored'
import { swapBrand, swapOwnWords, type Cropper } from '../swap'
import {
  goldenStoreNames,
  testBrand,
  testProducts,
  testRules,
  testVocabulary,
  testWords
} from './brand'
import type { GoldenEmail } from './report'

/**
 * DES-ENGINE-002 gate runner: each library-shaped golden email is
 * measured, stored as the blueprint job stores it (no pictures, no
 * links), brand-swapped for the synthetic test brand, drawn, measured and
 * checked for structure likeness (`copyBlueprint`) and for anything of
 * the source (`leaksOf`). It writes `results.json`, `summary.md`,
 * `index.html` and one side-by-side picture per email (the original, the
 * brand copy, the brand copy on a phone).
 */

export type BrandRow = {
  id: string
  title: string
  /** Every section copied and alike (none built from a block). */
  pass: boolean
  error: string | null
  picture: number | null
  drawings: number
  sections: Extract<CopyResult, { ok: true }>['sections']
  problems: string[]
  leaks: Leak[]
  pictureError?: string
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function sideBySide(
  browser: Browser,
  email: GoldenEmail,
  html: string,
  pass: boolean
) {
  const [source, copy, phone] = await Promise.all([
    pictureOf(browser, email.html, desktopWindow),
    pictureOf(browser, html, desktopWindow),
    pictureOf(browser, html, phoneWindow)
  ])
  const pic = (b: Buffer) => `data:image/jpeg;base64,${b.toString('base64')}`
  const head = (t: string) =>
    `<p style="font:bold 14px Arial;margin:0 0 6px">${t}</p>`
  const page = `<!doctype html><html><body style="margin:0;padding:16px;background:#ffffff"><p style="font:bold 18px Arial;margin:0 0 12px">${escape(email.id)}: ${pass ? 'PASS' : 'FAIL'}</p><table cellpadding="0" cellspacing="12"><tr valign="top"><td>${head('Original (library email)')}<img src="${pic(source)}"></td><td>${head('Brand copy')}<img src="${pic(copy)}"></td><td>${head('Brand copy on a phone (375 px)')}<img src="${pic(phone)}"></td></tr></table></body></html>`
  const context = await browser.newContext({
    viewport: { width: 1900, height: 800 },
    javaScriptEnabled: false
  })
  try {
    const p = await context.newPage()
    await p.route('**/*', (route) =>
      route.request().url().startsWith('data:')
        ? route.continue()
        : route.abort()
    )
    await p.setContent(page, { waitUntil: 'load' })
    return await p.screenshot({ type: 'jpeg', quality: 60, fullPage: true })
  } finally {
    await context.close()
  }
}

/** One library email copied for the test brand. */
export async function brandCopy(
  browser: Browser,
  email: GoldenEmail,
  cropper: Cropper | null
) {
  const opened = await measureHtml(browser, email.html, desktopWindow)
  if (!opened.ok) return { ok: false as const, error: opened.error }
  const measured = blueprintFrom(opened.measurement)
  if (!measured.ok) return { ok: false as const, error: measured.error }
  const full = measured.blueprint
  const stored = forStorage(full)
  const swapped = swapBrand({
    source: stored,
    brand: testBrand,
    products: testProducts,
    words: testWords,
    rules: testRules,
    cropper
  })
  if (!swapped.ok) return { ok: false as const, error: swapped.error }
  const result = await copyBlueprint(browser, stored, swapped.target, {
    blocked: swapped.blocked,
    lengthen: swapped.lengthen,
    brand: swapped.blockBrand
  })
  if (!result.ok) return { ok: false as const, error: result.error }
  const leaks = leaksOf({
    source: full,
    sourceHtml: email.html,
    html: result.html,
    sourceNames: goldenStoreNames,
    vocabulary: [...testVocabulary, ...swapOwnWords(testBrand)]
  })
  return { ok: true as const, result, leaks }
}

export async function runBrandGate(
  browser: Browser,
  emails: readonly GoldenEmail[],
  out: string | null,
  cropper: Cropper | null
) {
  if (out) mkdirSync(out, { recursive: true })
  const rows: BrandRow[] = []
  for (const email of emails) {
    const got = await brandCopy(browser, email, cropper).catch(
      (e: unknown) =>
        ({
          ok: false,
          error: e instanceof Error ? e.message : String(e)
        }) as const
    )
    if (!got.ok) {
      rows.push({
        id: email.id,
        title: email.title,
        pass: false,
        error: got.error,
        picture: null,
        drawings: 0,
        sections: [],
        problems: [],
        leaks: []
      })
      continue
    }
    const { result, leaks } = got
    rows.push({
      id: email.id,
      title: email.title,
      pass: result.pass,
      error: null,
      picture: Math.round(result.likeness.picture * 1000) / 1000,
      drawings: result.drawings,
      sections: result.sections,
      problems: [...result.problems],
      leaks
    })
    if (out) {
      try {
        writeFileSync(
          join(out, `${email.id}.jpg`),
          await sideBySide(browser, email, result.html, result.pass)
        )
      } catch (e) {
        rows.at(-1)!.pictureError =
          `The side-by-side picture could not be taken: ${e instanceof Error ? e.message : String(e)}`
      }
      writeFileSync(join(out, `${email.id}.copy.html`), result.html)
    }
  }
  if (out) writeReport(out, rows)
  return rows
}

const why = (r: BrandRow) => [
  ...(r.error ? [r.error] : []),
  ...r.problems,
  ...r.leaks.map((l) => `Leak (${l.kind}): ${l.value}`),
  ...r.sections.flatMap((s) =>
    s.fallback
      ? [s.fallback.reason]
      : s.problems.map((p) => `Section ${s.ordinal}: ${p}`)
  ),
  ...(r.pictureError ? [r.pictureError] : [])
]

function writeReport(out: string, rows: readonly BrandRow[]) {
  const passed = rows.filter((r) => r.pass).length
  const leaks = rows.reduce((n, r) => n + r.leaks.length, 0)
  writeFileSync(
    join(out, 'results.json'),
    JSON.stringify({ passed, total: rows.length, leaks, rows }, null, 2)
  )
  const lines = [
    `# Library 1:1 gate: ${passed} of ${rows.length} brand copies alike, ${leaks} leaks`,
    '',
    "Each library email is measured, stored without its pictures and links, copied for the synthetic test brand (its colours, fonts, logo, photos, products, offer and words), drawn, measured again and checked: the same structure as the original (every likeness limit of step 1; the logo keeps its height and place, its width follows the brand logo) and nothing of the original a reader could see (no picture, link, name, three-word phrase or word that is not the brand's own).",
    '',
    '| Email | Result | Grey boxes | Drawings | Leaks | Why |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.pass ? 'pass' : 'FAIL'} | ${r.picture === null ? '–' : `${Math.round(r.picture * 100)} %`} | ${r.drawings} | ${r.leaks.length} | ${why(r).slice(0, 3).join(' ').replace(/\|/g, '/') || '–'} |`
    )
  ]
  writeFileSync(join(out, 'summary.md'), `${lines.join('\n')}\n`)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Library 1:1 gate</title></head><body style="font:14px Arial;margin:24px"><h1>Library 1:1 gate: ${passed} of ${rows.length} alike, ${leaks} leaks</h1>${rows
    .map(
      (r) =>
        `<h2 id="${r.id}">${escape(r.id)}: ${r.pass ? 'pass' : 'FAIL'}</h2><p>${escape(r.title)}</p><ul>${why(
          r
        )
          .map((p) => `<li>${escape(p)}</li>`)
          .join(
            ''
          )}</ul>${r.error ? '' : `<img src="${r.id}.jpg" style="max-width:100%">`}`
    )
    .join('')}</body></html>`
  writeFileSync(join(out, 'index.html'), html)
}
