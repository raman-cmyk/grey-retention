// @vitest-environment node
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import { launch } from '@/lib/sandbox/browser.mjs'
import { runBlockGate } from './blocks-report'
import { goldenEmails } from './emails'

/**
 * DES-ENGINE-004's library gate (owner plan of 25 November 2026, step 4
 * "Scratch from the real library"): the 40 golden emails' sections become
 * the block library as the block job builds it from the inbox, with a
 * reported block count (distinct structural fingerprints) and a
 * de-duplication count. Each distinct block must draw back on its own like
 * its source section (`checkBlock`); at least `blockPassShare` of them do.
 * With `DESIGN_ENGINE_BROWSER=on` (the Design engine workflow), the report
 * and one picture per block go to `DESIGN_GOLDEN_OUT/blocks`.
 */
const on = process.env.DESIGN_ENGINE_BROWSER === 'on'
const out = process.env.DESIGN_GOLDEN_OUT ?? 'design-golden'
export const blockPassShare = 0.9

describe.skipIf(!on)('block library from the golden emails', () => {
  let browser: Browser
  beforeAll(async () => {
    const { chromium } = await import('@playwright/test')
    browser = await launch(chromium)
  })
  afterAll(async () => {
    await browser?.close()
  })

  it('cuts every golden section into blocks, folds near-identical ones and checks each', async () => {
    expect(goldenEmails).toHaveLength(40)
    const gate = await runBlockGate(browser, goldenEmails, join(out, 'blocks'))
    expect(gate.errors).toEqual([])
    expect(gate.emails).toBe(40)
    // Every section is either a candidate or skipped with its reason.
    expect(
      gate.candidates +
        gate.skipped.glue +
        gate.skipped.cannot_copy +
        gate.skipped.empty
    ).toBe(gate.sections)
    expect(gate.blocks + gate.merged).toBe(gate.candidates)
    expect(gate.blocks).toBeGreaterThan(40)
    // The golden emails share layouts (headers, footers, grids): some fold.
    expect(gate.merged).toBeGreaterThan(0)
    expect(gate.passed).toBeGreaterThanOrEqual(
      Math.ceil(gate.blocks * blockPassShare)
    )
    console.log(
      `Block library: ${gate.sections} sections, ${gate.candidates} candidates, ${gate.blocks} distinct blocks (${gate.merged} folded in), ${gate.passed} pass the quality check, ${gate.reused} used more than once.`
    )
  }, 900_000)
})
