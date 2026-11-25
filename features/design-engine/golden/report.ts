import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser } from '@playwright/test'
import {
  blueprintHeight,
  placedBoxes,
  type Blueprint,
  type PlacedBox
} from '../blueprint'
import { desktopWindow, phoneWindow, pictureOf } from '../browser'
import { copyDesign, type CopyResult } from '../copy'

/**
 * DES-ENGINE-001 golden set runner: measures each test email, draws it
 * back unchanged and checks the likeness (`copyDesign`), then writes what
 * the owner can look at: `results.json`, `summary.md`, `index.html` and,
 * per email, a side-by-side picture (the original, the redraw, the redraw
 * on a phone, and both layouts as grey boxes). CI uploads the folder.
 */

export type GoldenEmail = {
  id: string
  shape: 'library' | 'upload'
  title: string
  html: string
}

export type GoldenRow = {
  id: string
  shape: GoldenEmail['shape']
  title: string
  pass: boolean
  error: string | null
  picture: number | null
  bytes: number | null
  drawings: number
  sections: Extract<CopyResult, { ok: true }>['sections']
  problems: string[]
}

/** Grey boxes of a layout as a small SVG, `scale` of its size. */
export function greyBoxes(bp: Blueprint, scale = 0.5) {
  const tone: Record<PlacedBox['kind'], string> = {
    fill: '#ececec',
    text: '#bdbdbd',
    divider: '#9e9e9e',
    button: '#7a7a7a',
    image: '#5c5c5c'
  }
  const height = blueprintHeight(bp)
  const boxes = placedBoxes(bp)
    .map(
      (b) =>
        `<rect x="${(b.x * scale).toFixed(1)}" y="${(b.y * scale).toFixed(1)}" width="${(b.width * scale).toFixed(1)}" height="${(b.height * scale).toFixed(1)}" fill="${tone[b.kind]}"/>`
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(bp.width * scale)}" height="${Math.ceil(height * scale)}" style="background:#ffffff;border:1px solid #cccccc">${boxes}</svg>`
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function sideBySide(
  browser: Browser,
  email: GoldenEmail,
  result: Extract<CopyResult, { ok: true }>
) {
  const [source, drawn, phone] = await Promise.all([
    pictureOf(browser, email.html, desktopWindow),
    pictureOf(browser, result.html, desktopWindow),
    pictureOf(browser, result.html, phoneWindow)
  ])
  const pic = (b: Buffer) => `data:image/jpeg;base64,${b.toString('base64')}`
  const head = (t: string) =>
    `<p style="font:bold 14px Arial;margin:0 0 6px">${t}</p>`
  const page = `<!doctype html><html><body style="margin:0;padding:16px;background:#ffffff"><p style="font:bold 18px Arial;margin:0 0 12px">${escape(email.id)}: ${result.pass ? 'PASS' : 'FAIL'}</p><table cellpadding="0" cellspacing="12"><tr valign="top"><td>${head('Original (700 px window)')}<img src="${pic(source)}"></td><td>${head('Redraw')}<img src="${pic(drawn)}"></td><td>${head('Redraw on a phone (375 px)')}<img src="${pic(phone)}"></td><td>${head('Original as grey boxes')}${greyBoxes(result.source)}</td><td>${head('Redraw as grey boxes')}${greyBoxes(result.drawn)}</td></tr></table></body></html>`
  const context = await browser.newContext({
    viewport: { width: 2600, height: 800 },
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

/** Runs the golden set and writes the folder; returns the rows. */
export async function runGoldenSet(
  browser: Browser,
  emails: readonly GoldenEmail[],
  out: string | null
) {
  if (out) mkdirSync(out, { recursive: true })
  const rows: GoldenRow[] = []
  for (const email of emails) {
    const result = await copyDesign(browser, email.html).catch(
      (e: unknown) =>
        ({
          ok: false,
          error: e instanceof Error ? e.message : String(e)
        }) as const
    )
    if (!result.ok) {
      rows.push({
        id: email.id,
        shape: email.shape,
        title: email.title,
        pass: false,
        error: result.error,
        picture: null,
        bytes: null,
        drawings: 0,
        sections: [],
        problems: []
      })
      continue
    }
    rows.push({
      id: email.id,
      shape: email.shape,
      title: email.title,
      pass: result.pass,
      error: null,
      picture: Math.round(result.likeness.picture * 1000) / 1000,
      bytes: result.bytes,
      drawings: result.drawings,
      sections: result.sections,
      problems: result.problems
    })
    if (out) {
      try {
        writeFileSync(
          join(out, `${email.id}.jpg`),
          await sideBySide(browser, email, result)
        )
      } catch (e) {
        // A picture that cannot be taken is noted; the report is still written.
        rows
          .at(-1)!
          .problems.push(
            `The side-by-side picture could not be taken: ${e instanceof Error ? e.message : String(e)}`
          )
      }
      writeFileSync(join(out, `${email.id}.redraw.html`), result.html)
    }
  }
  if (out) writeReport(out, rows)
  return rows
}

function writeReport(out: string, rows: readonly GoldenRow[]) {
  const passed = rows.filter((r) => r.pass).length
  writeFileSync(
    join(out, 'results.json'),
    JSON.stringify({ passed, total: rows.length, rows }, null, 2)
  )
  const lines = [
    `# Design engine golden set: ${passed} of ${rows.length} pass`,
    '',
    'Each test email is measured in the safe browser, drawn back from its blueprint, measured again and compared (same sections in the same order, columns within 2 px, sections within 5 % of their height, text, button and picture sizes within 1 px, picture shapes within 2 %, grey-box layouts at least 90 % alike, and no problem at 375 px).',
    '',
    '| Email | Shape | Result | Grey boxes | Size | Drawings | Why |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => {
      const why =
        r.error ??
        [
          ...r.problems,
          ...r.sections.flatMap((s) =>
            s.fallback
              ? [s.fallback.reason]
              : s.problems.map((p) => `Section ${s.ordinal}: ${p}`)
          )
        ]
          .slice(0, 3)
          .join(' ')
      return `| ${r.id} | ${r.shape} | ${r.pass ? 'pass' : 'FAIL'} | ${r.picture === null ? '–' : `${Math.round(r.picture * 100)} %`} | ${r.bytes === null ? '–' : `${Math.round(r.bytes / 1024)} KB`} | ${r.drawings} | ${why.replace(/\|/g, '/') || '–'} |`
    })
  ]
  writeFileSync(join(out, 'summary.md'), `${lines.join('\n')}\n`)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Design engine golden set</title></head><body style="font:14px Arial;margin:24px"><h1>Design engine golden set: ${passed} of ${rows.length} pass</h1>${rows
    .map(
      (r) =>
        `<h2 id="${r.id}">${escape(r.id)}: ${r.pass ? 'pass' : 'FAIL'}</h2><p>${escape(r.title)}${r.error ? ` · ${escape(r.error)}` : ''}</p><ul>${[...r.problems, ...r.sections.flatMap((s) => (s.fallback ? [s.fallback.reason] : s.problems.map((p) => `Section ${s.ordinal}: ${p}`)))].map((p) => `<li>${escape(p)}</li>`).join('')}</ul>${r.error ? '' : `<img src="${r.id}.jpg" style="max-width:100%">`}`
    )
    .join('')}</body></html>`
  writeFileSync(join(out, 'index.html'), html)
}
