// @vitest-environment node
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import { launch } from '@/lib/sandbox/browser.mjs'
import { testCropper } from './brand'
import { runBrandGate } from './brand-report'
import { libraryEmails } from './library'

/**
 * DES-ENGINE-002's gate (owner plan of 25 November 2026, step 2 "Library
 * 1:1"): the 20 library-shaped golden emails, each copied for a synthetic
 * test brand, keep the original's structure on at least 18 of 20, and no
 * copy shows a word, picture, link or name of the original. With
 * `DESIGN_ENGINE_BROWSER=on` (the Design engine workflow), the pictures go
 * to `DESIGN_GOLDEN_OUT/library-brand`.
 *
 * The photos are the test brand's plain colours, cut to each slot's shape
 * by the fake image worker (exact for a plain colour). Without a cropper
 * (as on a live store today, where no image service is set up) only
 * photos of the slot's own shape fit; that score is written to
 * `library-brand-no-crop` for the owner to see, not gated.
 */
const on = process.env.DESIGN_ENGINE_BROWSER === 'on'
const out = process.env.DESIGN_GOLDEN_OUT ?? 'design-golden'
const only = (process.env.DESIGN_GOLDEN_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
export const brandGateTarget = 18

describe.skipIf(!on)('library 1:1 gate', () => {
  let browser: Browser
  beforeAll(async () => {
    const { chromium } = await import('@playwright/test')
    browser = await launch(chromium)
  })
  afterAll(async () => {
    await browser?.close()
  })

  const emails = (
    only.length
      ? libraryEmails.filter((e) => only.some((o) => e.id.startsWith(o)))
      : libraryEmails
  ).map((e) => ({ ...e, shape: 'library' as const }))

  it(`copies at least ${brandGateTarget} of the 20 library emails for a brand, with no leak`, async () => {
    if (!only.length) expect(libraryEmails).toHaveLength(20)
    const rows = await runBrandGate(
      browser,
      emails,
      join(out, 'library-brand'),
      testCropper
    )
    expect(
      rows.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`)
    ).toEqual([])
    expect(
      rows.flatMap((r) => r.leaks.map((l) => `${r.id}: ${l.kind} ${l.value}`))
    ).toEqual([])
    if (!only.length)
      expect(rows.filter((r) => r.pass).length).toBeGreaterThanOrEqual(
        brandGateTarget
      )
  }, 600_000)

  it('without a cropper, sections no photo fits are built from a block and say why, with no leak', async () => {
    const rows = await runBrandGate(
      browser,
      emails,
      join(out, 'library-brand-no-crop'),
      null
    )
    expect(
      rows.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`)
    ).toEqual([])
    expect(rows.flatMap((r) => r.leaks)).toEqual([])
    for (const r of rows)
      for (const s of r.sections)
        if (s.result !== 'copied')
          expect(s.fallback?.reason).toMatch(/^Section \d+ \(/)
  }, 600_000)
})
