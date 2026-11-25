// @vitest-environment node
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import { launch } from '@/lib/sandbox/browser.mjs'
import { testCropper, testProducts } from './brand'
import { runBrandGate } from './brand-report'
import { libraryEmails } from './library'
import { noisyPng, photoServer } from './noisy'
import { photoTools } from '../photos'

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
 * photos of the slot's own shape fit: 9 of 20 copy fully (25 Nov), the
 * rest build their sections from library blocks with the reason. That
 * path is the one live stores take, so it has its own floor
 * (`noCropFloor`) and its pictures go to `library-brand-no-crop`.
 */
const on = process.env.DESIGN_ENGINE_BROWSER === 'on'
const out = process.env.DESIGN_GOLDEN_OUT ?? 'design-golden'
const only = (process.env.DESIGN_GOLDEN_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
export const brandGateTarget = 18
/** The path live stores take today (no cropper): 9 observed, 1 of margin. */
export const noCropFloor = 8
/** The real centre cut on a canvas (DES-ENGINE-002b): the path live stores take. */
export const canvasFloor = 18

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

  it(`without a cropper, at least ${noCropFloor} copy fully; the other sections are built from a block and say why, with no leak`, async () => {
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
    if (!only.length)
      expect(rows.filter((r) => r.pass).length).toBeGreaterThanOrEqual(
        noCropFloor
      )
  }, 600_000)

  it(`with the real centre cut (a canvas in the locked browser), at least ${canvasFloor} copy fully, with no leak`, async () => {
    // The first product's photo is a detailed, noisy 1,600 × 1,000 photo
    // on Shopify's photo host, served by a loopback server in pieces with
    // no length (its JPEG cut is far larger than a blueprint keeps).
    const server = await photoServer({
      '/s/files/test/noisy-green.png': noisyPng(1600, 1000)
    })
    const products = testProducts.map((p, i) =>
      i === 0
        ? {
            ...p,
            photo: {
              src: 'https://cdn.shopify.com/s/files/test/noisy-green.png',
              width: 0,
              height: 0,
              alt: p.title
            }
          }
        : p
    )
    const rows = await runBrandGate(
      browser,
      emails,
      join(out, 'library-brand-canvas'),
      'canvas',
      { tools: photoTools(browser, { open: server.open }), products }
    ).finally(server.close)
    expect(
      rows.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`)
    ).toEqual([])
    expect(rows.flatMap((r) => r.leaks)).toEqual([])
    // The noisy photo was cut and used (no section says it could not be).
    expect(
      rows.flatMap((r) =>
        r.sections.filter((x) =>
          /photo that could not be used/.test(x.fallback?.reason ?? '')
        )
      )
    ).toEqual([])
    if (!only.length)
      expect(rows.filter((r) => r.pass).length).toBeGreaterThanOrEqual(
        canvasFloor
      )
  }, 600_000)
})
