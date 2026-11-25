// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import { launch } from '@/lib/sandbox/browser.mjs'
import { goldenEmails } from './emails'
import { runGoldenSet } from './report'

/**
 * DES-ENGINE-001's gate: the 40 golden emails (20 library-shaped, 20
 * upload-shaped) are measured, drawn back unchanged and checked; at least
 * 36 must pass the likeness check. It needs Chromium, so it runs only with
 * `DESIGN_ENGINE_BROWSER=on` (the Design engine workflow sets it and
 * uploads `DESIGN_GOLDEN_OUT`, default `design-golden/`, as an artifact).
 */
const on = process.env.DESIGN_ENGINE_BROWSER === 'on'
const out = process.env.DESIGN_GOLDEN_OUT ?? 'design-golden'
/** A part of the set, for working on one email (`DESIGN_GOLDEN_ONLY=lib-01,up-03`). */
const only = (process.env.DESIGN_GOLDEN_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
export const goldenTarget = 36

describe.skipIf(!on)('design engine golden set', () => {
  let browser: Browser
  beforeAll(async () => {
    const { chromium } = await import('@playwright/test')
    // As the inbox job launches it: no secret, its OS sandbox where possible.
    browser = await launch(chromium)
  })
  afterAll(async () => {
    await browser?.close()
  })

  it(`draws at least ${goldenTarget} of the 40 golden emails back alike`, async () => {
    if (!only.length) expect(goldenEmails).toHaveLength(40)
    const emails = only.length
      ? goldenEmails.filter((e) => only.some((o) => e.id.startsWith(o)))
      : goldenEmails
    const rows = await runGoldenSet(browser, emails, out)
    const passed = rows.filter((r) => r.pass).length
    expect(
      rows.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`)
    ).toEqual([])
    if (!only.length) expect(passed).toBeGreaterThanOrEqual(goldenTarget)
  }, 600_000)
})
