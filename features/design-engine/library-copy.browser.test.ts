// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import { launch } from '@/lib/sandbox/browser.mjs'
import { blueprint, section } from './fixtures'
import { forStorage } from './stored'
import { drawBlueprint } from './render'
import { footerAddedWhy, libraryCopy } from './library-copy'
import {
  testBrand,
  testCropper,
  testProducts,
  testRules,
  testVocabulary,
  testWords
} from './golden/brand'

const on = process.env.DESIGN_ENGINE_BROWSER === 'on'

describe.skipIf(!on)('a library copy (DES-ENGINE-002b)', () => {
  let browser: Browser
  beforeAll(async () => {
    const { chromium } = await import('@playwright/test')
    browser = await launch(chromium)
  })
  afterAll(async () => {
    await browser?.close()
  })

  const input = (source = blueprint({ sections: [section()] })) => ({
    source: forStorage(source),
    sourceHtml: drawBlueprint(source),
    sourceNames: ['Rival Store', 'example.com'],
    brand: testBrand,
    products: testProducts,
    words: testWords,
    rules: testRules,
    vocabulary: testVocabulary,
    crop: testCropper
  })

  it('adds the library Footer block when the original had no footer, and says why', async () => {
    const got = await libraryCopy(browser, input())
    if (!got.ok) throw new Error(got.error)
    expect(got.footerAdded).toBe(true)
    const footer = got.sections.at(-1)!
    expect(footer.result).toBe('library')
    expect(footer.fallback?.reason).toBe(
      `Section 2 (footer) ${footerAddedWhy}, so it was built from the library's Footer block.`
    )
    expect(got.html).toContain('Unsubscribe')
    expect(got.leaks).toEqual([])
    // The hero is still a 1:1 copy.
    expect(got.sections[0]!.result).toBe('copied')
  })

  it('refuses to run without the original’s own HTML', async () => {
    const got = await libraryCopy(browser, { ...input(), sourceHtml: '' })
    expect(got).toEqual({
      ok: false,
      error:
        'The leak check needs the original email’s own HTML, not only its stored blueprint.',
      // The same every time: never tried again.
      retry: false
    })
  })
})
