// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import { launch } from '@/lib/sandbox/browser.mjs'
import { desktopWindow, measureHtml } from '@/features/design-engine/browser'
import { libraryCopy } from '@/features/design-engine/library-copy'
import { blueprintFrom } from '@/features/design-engine/measure'
import { forStorage } from '@/features/design-engine/stored'
import {
  goldenStoreNames,
  testBrand,
  testCropper,
  testProducts,
  testRules,
  testVocabulary,
  testWords
} from '@/features/design-engine/golden/brand'
import { libraryEmails } from '@/features/design-engine/golden/library'
import type { PhotoTools } from '@/features/design-engine/photos'
import type { SwapBrand, SwapPicture } from '@/features/design-engine/swap'
import { hardProblems } from './hard-checks'
import { copyPhotoPath, photoPlaceholder } from './library-copy'
import { withPhotoLinks } from './library-copy-live'

/**
 * DES-ENGINE-002b2: a library copy as Create email stores it, through the
 * email's hard checks (Gmail size, width, alt text, links, Klaviyo's
 * footer, the max discount, spam, accessibility). The 20 library emails
 * are copied for the test brand in Klaviyo's drawing (its footer tags),
 * their cut photos given signed-link-like https addresses, then checked as
 * the design step checks them. A copy short of the checks is drawn with
 * coded blocks in the app (with its reason), so this measures how many
 * copies reach Klaviyo as copies.
 */
const on = process.env.DESIGN_ENGINE_BROWSER === 'on'
/** Copies that pass every hard check, of 20 (19 observed on 25 Nov: the letter-shaped one has no heading). */
export const checkedFloor = 18

vi.mock('server-only', () => ({}))

/**
 * The test brand's pictures as a live store has them: https addresses on
 * a catalog host (each plain-colour picture behind its own address), cut
 * by the fake cropper through the photo tools, so each cut is a
 * placeholder the app signs, as in the browser job.
 */
const inline = new Map<string, SwapPicture>()
const hosted = (p: SwapPicture | null | undefined): SwapPicture | null => {
  if (!p) return null
  const src = `https://cdn.shopify.com/test/${inline.size}.png`
  inline.set(src, p)
  return { ...p, src }
}
const brand: SwapBrand = {
  ...testBrand,
  logo: hosted(testBrand.logo),
  logoOnDark: hosted(testBrand.logoOnDark),
  photos: (testBrand.photos ?? []).map((p) => hosted(p)!),
  icons: (testBrand.icons ?? []).map((p) => ({ ...p, ...hosted(p)! }))
}
const products = testProducts.map((p) => ({ ...p, photo: hosted(p.photo) }))
const tools: PhotoTools = {
  sizeOf: async (src) => {
    const p = inline.get(src)
    return p ? { width: p.width, height: p.height } : { failed: 'unknown' }
  },
  cropTo: async (photo, width, height) => {
    const p = inline.get(photo.src)
    const cut = p ? testCropper(p, width, height) : null
    return cut ?? { failed: 'cannot cut' }
  }
}

describe.skipIf(!on)('library copies through the hard checks', () => {
  let browser: Browser
  beforeAll(async () => {
    const { chromium } = await import('@playwright/test')
    browser = await launch(chromium)
  })
  afterAll(async () => {
    await browser?.close()
  })

  it(`at least ${checkedFloor} of the 20 library copies pass every hard check`, async () => {
    const failed: string[] = []
    for (const email of libraryEmails) {
      const opened = await measureHtml(browser, email.html, desktopWindow)
      if (!opened.ok) throw new Error(opened.error)
      const measured = blueprintFrom(opened.measurement)
      if (!measured.ok) throw new Error(measured.error)
      const got = await libraryCopy(browser, {
        source: forStorage(measured.blueprint),
        sourceHtml: email.html,
        sourceNames: goldenStoreNames,
        brand,
        products,
        words: testWords,
        rules: testRules,
        vocabulary: testVocabulary,
        crop: 'canvas',
        tools,
        mode: 'klaviyo'
      })
      if (!got.ok) {
        failed.push(`${email.id}: ${got.error}`)
        continue
      }
      expect(got.leaks, email.id).toEqual([])
      // The cut photos as the app signs them (an https link each).
      const links = new Map(
        got.cuts.map((_, i) => [
          i,
          `https://project.supabase.co/storage/v1/object/sign/email-copies/${copyPhotoPath('t', 'b', i)}?token=x`
        ])
      )
      const html = withPhotoLinks(got.html, links)
      expect(html).not.toContain(photoPlaceholder(0).slice(0, 28))
      const problems = hardProblems(html, {
        maxDiscountPercent: testRules.maxDiscountPercent,
        known: [testBrand.name, ...testProducts.map((p) => p.title)],
        storeHosts: [new URL(testBrand.site).hostname],
        subject: 'Fresh from Fernhill',
        preheader: 'New this week',
        brandName: testBrand.name,
        storeText: []
      })
      if (problems.length)
        failed.push(
          `${email.id}: ${problems.map((p) => `${p.check} (${p.problem})`).join('; ')}`
        )
    }
    console.log(
      `Library copies through the hard checks: ${20 - failed.length} of 20.\n${failed.join('\n')}`
    )
    expect(20 - failed.length).toBeGreaterThanOrEqual(checkedFloor)
  }, 600_000)
})
