// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import { launch } from '@/lib/sandbox/browser.mjs'
import type { BlockBrand } from '@/features/blocks/brand'
import type { ImagePart, RowItem, TextPart } from './blueprint'
import {
  desktopWindow,
  measureHtml,
  phoneWindow,
  type BrowserOptions
} from './browser'
import { copyDesign, fallbackLines } from './copy'
import {
  button,
  classic,
  columns,
  footerRow,
  img,
  link,
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
 * DES-ENGINE-001 in the real browser (Chromium, launched with its OS
 * sandbox where the machine allows one; `DESIGN_ENGINE_BROWSER=on`, as the
 * Design engine workflow runs it): what the golden set does not show on
 * its own.
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

/** A short email: a logo, a paragraph with a link, a button, a footer. */
const plainEmail = classic({
  title: 'Plain',
  rows: [
    logoRow(),
    textRow(
      `${para(530, 20)} <a href="${link('story')}" style="color:#225588">Read the story</a>.`,
      '24px 40px',
      { size: 16, line: 24, align: 'center', color: '#333333' }
    ),
    row(button({ label: 'Shop now', bg: '#222222' }), 'padding:0 0 30px'),
    footerRow()
  ]
})

const brand: BlockBrand = {
  name: 'Sample Store',
  site: 'https://shop.example.com',
  font: 'Arial',
  ink: '#222222',
  background: '#f2f2f2',
  accent: '#aa2222',
  dark: '#111111'
}

describe.skipIf(!on)('the design engine in the browser', () => {
  let browser: Browser
  beforeAll(async () => {
    const { chromium } = await import('@playwright/test')
    browser = await launch(chromium)
  })
  afterAll(async () => {
    await browser?.close()
  })

  const measured = async (
    html: string,
    width = desktopWindow,
    options: BrowserOptions = {}
  ) => {
    const got = await measureHtml(browser, html, width, options)
    if (!got.ok) throw new Error(got.error)
    return got.measurement
  }

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
    // The other sections are still copied, alike and unchanged.
    expect(
      result.sections
        .filter((s) => s.result === 'copied')
        .every((s) => s.problems.length === 0)
    ).toBe(true)
    expect(result.html).not.toContain(timerPicture)
  }, 60_000)

  it('leaves out a moving picture with no words and still copies every section after it', async () => {
    const html = classic({
      title: 'Banner',
      rows: [
        logoRow(),
        row(
          `<img src="${timerPicture}" width="600" height="200" alt="" style="display:block">`
        ),
        textRow(para(520, 24), '24px 40px', {
          size: 16,
          line: 24,
          align: 'center'
        }),
        row(button({ label: 'Shop now', bg: '#222222' }), 'padding:0 0 30px'),
        footerRow()
      ]
    })
    const result = await copyDesign(browser, html)
    if (!result.ok) throw new Error(result.error)
    expect(result.sections.map((s) => s.result)).toEqual([
      'copied',
      'left_out',
      'copied',
      'copied',
      'copied'
    ])
    expect(fallbackLines(result)[0]).toMatch(
      /^Section 2 \(hero\) has a countdown timer or moving picture, which cannot be copied, and it has nothing a library block can draw, so it was left out\.$/
    )
    expect(
      result.sections
        .filter((s) => s.result === 'copied')
        .flatMap((s) => s.problems)
    ).toEqual([])
    expect(result.likeness.sections.map((s) => s.ordinal)).toEqual([1, 3, 4, 5])
  }, 60_000)

  it('draws a failing section twice more, corrected, then builds it from the closest block with the reason', async () => {
    // A drawing code that always draws section 2 20 px taller than asked,
    // more each time, so no correction can catch up.
    let calls = 0
    const result = await copyDesign(browser, plainEmail, {
      drawer: (bp, options) => {
        calls++
        const grown = structuredClone(bp)
        const s = grown.sections.find((x) => x.ordinal === 2)!
        s.bottom += 20 * calls
        return drawBlueprint(grown, options)
      }
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.drawings).toBe(4)
    const second = result.sections[1]!
    expect(second).toMatchObject({ ordinal: 2, result: 'library', tries: 3 })
    expect(second.fallback!.reason).toMatch(
      /^Section 2 \(\w+\) still differed from the original after 3 tries \(it is 20 px taller than the original \(\d+ px, 5 % allowed\)\), so it was built from the library's .+ block\.$/
    )
    // The other sections were right from the first drawing.
    expect(
      result.sections.filter((s) => s.ordinal !== 2).map((s) => s.result)
    ).toEqual(['copied', 'copied', 'copied'])
    expect(result.pass).toBe(false)
  }, 60_000)

  it('fails a copy whose sizes are right but whose content changed: a dropped link, a wrong colour', async () => {
    const dropLink = await copyDesign(browser, plainEmail, {
      retries: 0,
      drawer: (bp, options) => {
        const changed = structuredClone(bp)
        const text = changed.sections[1]!.items[0] as TextPart
        text.runs = text.runs.map((r) => {
          const plain = { ...r }
          delete plain.href
          return plain
        })
        return drawBlueprint(changed, options)
      }
    })
    if (!dropLink.ok) throw new Error(dropLink.error)
    expect(dropLink.sections[1]!.problems).toContain(
      'In it, part 1: its words, links or their look differ from the original.'
    )
    const recolour = await copyDesign(browser, plainEmail, {
      retries: 0,
      drawer: (bp, options) => {
        const changed = structuredClone(bp)
        ;(changed.sections[1]!.items[0] as TextPart).color = '#ff0000'
        return drawBlueprint(changed, options)
      }
    })
    if (!recolour.ok) throw new Error(recolour.error)
    expect(recolour.sections[1]!.problems.join(' ')).toMatch(
      /its words are #ff0000 where the original's are #333333/
    )
    // A copy that swaps the content on purpose (step 2) skips the check.
    const swapped = await copyDesign(browser, plainEmail, {
      keepContent: false,
      drawer: (bp, options) => {
        const changed = structuredClone(bp)
        ;(changed.sections[1]!.items[0] as TextPart).color = '#ff0000'
        return drawBlueprint(changed, options)
      }
    })
    expect(swapped.ok && swapped.pass).toBe(true)
  }, 60_000)

  it('gives plain reasons, not exceptions: Klaviyo without the brand, a picture not uploaded, a measurement out of time', async () => {
    expect(await copyDesign(browser, timerEmail, { mode: 'klaviyo' })).toEqual({
      ok: false,
      error: 'An email for Klaviyo is drawn for a brand: give the brand.'
    })
    expect(
      await copyDesign(browser, timerEmail, { mode: 'klaviyo', brand })
    ).toEqual({
      ok: false,
      error: 'Upload every picture to Klaviyo before it goes into an email.'
    })
    expect(await copyDesign(browser, plainEmail, { deadlineMs: 1 })).toEqual({
      ok: false,
      error: 'The email took too long to open in the browser.'
    })
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
    const source = blueprintFrom(await measured(html))
    if (!source.ok) throw new Error(source.error)
    const changed = structuredClone(source.blueprint)
    const grid = changed.sections[0]!.items[0] as RowItem
    grid.columns[1]!.width -= 10
    ;(grid.columns[1]!.items[0] as ImagePart).width -= 10
    const redraw = blueprintFrom(
      await measured(drawBlueprint(changed), desktopWindow, {
        trustMarks: true
      })
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
      phoneProblems(await measured(html, phoneWindow), phoneWindow).size
    ).toBeGreaterThan(0)
    const result = await copyDesign(browser, html)
    if (!result.ok) throw new Error(result.error)
    expect(
      phoneProblems(
        await measured(result.html, phoneWindow, { trustMarks: true }),
        phoneWindow
      )
    ).toEqual(new Map())
  }, 60_000)

  it('ignores section marks an uploaded email brings, and cuts it with the inbox splitter', async () => {
    const html = `<!doctype html><html><body><table width="600"><tr data-gr-section="7"><td style="font:16px/24px Arial">${para(540, 8)}</td></tr><tr data-gr-section="7"><td style="font:16px/24px Arial">${para(541, 8)}</td></tr></table></body></html>`
    const bp = blueprintFrom(await measured(html))
    expect(bp.ok && bp.blueprint.sections.map((s) => s.ordinal)).toEqual([1, 2])
    // Marks we wrote ourselves (a stored inbox email, a redraw) are kept.
    const ours = blueprintFrom(
      await measured(html, desktopWindow, { trustMarks: true })
    )
    expect(ours.ok && ours.blueprint.sections).toHaveLength(1)
  }, 60_000)
})
