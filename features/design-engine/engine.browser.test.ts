// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import type { ImagePart, RowItem } from './blueprint'
import { desktopWindow, measureHtml, phoneWindow } from './browser'
import { copyDesign, fallbackLines } from './copy'
import {
  button,
  classic,
  columns,
  footerRow,
  img,
  logoRow,
  para,
  row,
  textRow
} from './golden/kit'
import { timerPicture } from './golden/pictures'
import { compareBlueprints, phoneProblems } from './likeness'
import { blueprintFrom } from './measure'
import { drawBlueprint } from './render'

/**
 * DES-ENGINE-001 in the real browser (Chromium; `DESIGN_ENGINE_BROWSER=on`,
 * as the Design engine workflow runs it): what the golden set does not
 * show on its own.
 */
const on = process.env.DESIGN_ENGINE_BROWSER === 'on'

const timerEmail = classic({
  title: 'Timer',
  rows: [
    logoRow(),
    textRow(para(500, 20), '20px 40px', {
      size: 16,
      line: 24,
      align: 'center'
    }),
    row(
      `<p style="margin:0 0 12px;font:bold 24px/30px Arial;color:#111111;text-align:center">Sale ends soon</p><img src="${timerPicture}" width="300" height="80" alt="" style="display:block;margin:0 auto"><div style="height:16px"></div>${button({ label: 'Shop the sale', bg: '#aa2222' })}`,
      'padding:20px 40px 30px'
    ),
    footerRow()
  ]
})

describe.skipIf(!on)('the design engine in the browser', () => {
  let browser: Browser
  beforeAll(async () => {
    const { chromium } = await import('@playwright/test')
    browser = await chromium.launch({
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }
    })
  })
  afterAll(async () => {
    await browser?.close()
  })

  it('builds a countdown timer section from the closest library block and says which and why', async () => {
    const result = await copyDesign(browser, timerEmail)
    if (!result.ok) throw new Error(result.error)
    expect(result.pass).toBe(false)
    const timer = result.sections.find((s) => s.result !== 'copied')!
    expect(timer).toMatchObject({
      ordinal: 3,
      result: 'library',
      tries: 0,
      fallback: { block: 'offer_banner' }
    })
    expect(fallbackLines(result)).toEqual([
      "Section 3 (offer) has a countdown timer or moving picture, which cannot be copied, so it was built from the library's Offer banner block."
    ])
    // The other sections are still copied and alike.
    expect(
      result.sections
        .filter((s) => s.result === 'copied')
        .every((s) => s.problems.length === 0)
    ).toBe(true)
    expect(result.html).not.toContain(timerPicture)
  }, 60_000)

  it('catches a redraw that is not alike: a column made 10 px narrower', async () => {
    const html = classic({
      title: 'Grid',
      rows: [
        row(
          columns(
            [
              { width: 260, html: img(260, 200, '#cccccc', 'A') },
              { width: 260, html: img(260, 200, '#aaaaaa', 'B') }
            ],
            20
          ),
          'padding:20px 30px'
        ),
        footerRow()
      ]
    })
    const source = blueprintFrom(await measureHtml(browser, html))
    if (!source.ok) throw new Error(source.error)
    const changed = structuredClone(source.blueprint)
    const grid = changed.sections[0]!.items[0] as RowItem
    grid.columns[1]!.width -= 10
    ;(grid.columns[1]!.items[0] as ImagePart).width -= 10
    const redraw = blueprintFrom(
      await measureHtml(browser, drawBlueprint(changed))
    )
    if (!redraw.ok) throw new Error(redraw.error)
    const verdict = compareBlueprints(source.blueprint, redraw.blueprint)
    expect(verdict.pass).toBe(false)
    expect(verdict.sections[0]!.problems.join(' ')).toMatch(
      /column 2 is 10 px narrower/
    )
  }, 60_000)

  it('stacks a redraw cleanly at 375 px where the original did not', async () => {
    // A fixed 600 px email with no phone styles: wider than a phone.
    const html = classic({
      title: 'Fixed',
      head: '',
      rows: [
        row(
          columns(
            [0, 1, 2].map(() => ({
              width: 180,
              html: img(180, 180, '#bbbbbb', 'P')
            })),
            30
          ),
          'padding:20px 15px'
        )
      ]
    }).replace(/@media[^}]*\}[^}]*\}[^}]*\}/, '')
    expect(
      phoneProblems(await measureHtml(browser, html, phoneWindow), phoneWindow)
        .size
    ).toBeGreaterThan(0)
    const result = await copyDesign(browser, html)
    if (!result.ok) throw new Error(result.error)
    expect(
      phoneProblems(
        await measureHtml(browser, result.html, phoneWindow),
        phoneWindow
      )
    ).toEqual(new Map())
  }, 60_000)

  it('measures in the locked browser: no navigation, no outside picture loaded', async () => {
    const html = `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://example.org/"><link rel="stylesheet" href="https://example.org/x.css"></head><body><table width="600"><tr><td><img src="https://example.org/x.png" width="200" height="100" alt="Outside"></td></tr><tr><td style="font:16px/24px Arial">${para(510, 10)}</td></tr></table></body></html>`
    const m = await measureHtml(browser, html, desktopWindow)
    const bp = blueprintFrom(m)
    if (!bp.ok) throw new Error(bp.error)
    // The picture keeps its address and its size from the email, unloaded.
    expect(bp.blueprint.sections[0]!.items[0]).toMatchObject({
      type: 'image',
      src: 'https://example.org/x.png',
      width: 200,
      height: 100
    })
    expect(bp.blueprint.sections).toHaveLength(2)
  }, 60_000)
})
