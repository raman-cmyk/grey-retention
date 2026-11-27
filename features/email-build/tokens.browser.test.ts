// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import { launch } from '@/lib/sandbox/browser.mjs'
import { renderEmail } from '@/features/blocks/render'
import { sampleBlocks, sampleBrand } from '@/features/blocks/samples'
import {
  desktopWindow,
  phoneWindow,
  pictureOf
} from '@/features/design-engine/browser'
import { resolveTokens, tokenValues } from '@/features/design-engine/tokens'
import { samplePage } from '@/features/onboarding/site/sample'
import { siteTokens } from '@/features/onboarding/site/tokens'

/**
 * PICK-006's token gate, the coded blocks (design A, the fallback of every
 * other way): the same blocks for the two sample sites' tokens, read as
 * the Site reader reads them, measured in the browser: visibly different
 * spaces, corners and buttons; every drawn size inside the email-safe
 * limits; nothing wider than a 375 px phone. The Scratch half of the gate
 * is in `scratch.browser.test.ts`. Pictures go to
 * `DESIGN_GOLDEN_OUT/tokens`.
 */
const on = process.env.DESIGN_ENGINE_BROWSER === 'on'
const out = process.env.DESIGN_GOLDEN_OUT ?? 'design-golden'

type Measured = {
  width: number
  buttons: {
    radius: number
    background: string
    border: number
    padTop: number
    padLeft: number
    transform: string
  }[]
  rowPads: number[]
  h1: number
  /** The smallest text drawn. */
  smallest: number
  pictureRadius: number[]
}

async function measure(
  browser: Browser,
  html: string,
  width: number
): Promise<Measured> {
  const context = await browser.newContext({
    viewport: { width, height: 900 }
  })
  await context.route('**/*', (r) =>
    r.request().url().startsWith('data:') ? r.continue() : r.abort()
  )
  const page = await context.newPage()
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    return await page.evaluate(() => {
      const px = (v: string) => Number.parseFloat(v) || 0
      const cells = [...document.querySelectorAll('td')].filter((td) =>
        td.querySelector(':scope > a[target]')
      )
      // A button's cell sets its own corners (rows and columns never do).
      const buttons = cells
        .filter((td) =>
          (td.getAttribute('style') ?? '').includes('border-radius')
        )
        .map((td) => {
          const s = getComputedStyle(td)
          const a = td.querySelector('a')!
          return {
            radius: px(s.borderTopLeftRadius),
            background: s.backgroundColor,
            border: px(s.borderTopWidth),
            padTop: px(s.paddingTop),
            padLeft: px(s.paddingLeft),
            transform: getComputedStyle(a).textTransform
          }
        })
      const rowPads = [...document.querySelectorAll('tr[data-block] > td')]
        .map((td) => px(getComputedStyle(td).paddingTop))
        .filter((n) => n > 0)
      const h1 = document.querySelector('h1')
      const sizes = [...document.querySelectorAll('p, span, a, h1, h2')]
        .filter((e) => (e.textContent ?? '').trim())
        .map((e) => px(getComputedStyle(e).fontSize))
      return {
        width: document.documentElement.scrollWidth,
        buttons,
        rowPads,
        h1: h1 ? px(getComputedStyle(h1).fontSize) : 0,
        smallest: Math.min(...sizes),
        pictureRadius: [...document.querySelectorAll('img')].map((i) =>
          px(getComputedStyle(i).borderTopLeftRadius)
        )
      }
    })
  } finally {
    await context.close()
  }
}

describe.skipIf(!on)('token gate: coded blocks (PICK-006)', () => {
  let browser: Browser
  beforeAll(async () => {
    const { chromium } = await import('@playwright/test')
    browser = await launch(chromium)
  })
  afterAll(async () => {
    await browser?.close()
  })

  it('draws the same blocks visibly differently for two brands’ tokens, inside the limits, and fits a phone', async () => {
    const dir = join(out, 'tokens')
    mkdirSync(dir, { recursive: true })
    const blocks = Object.values(sampleBlocks)
    const drawn: Record<string, { desk: Measured; phone: Measured }> = {}
    for (const [look, domain] of [
      ['calm', 'fernhill.example'],
      ['soft', 'birchwood.example']
    ] as const) {
      const tokens = tokenValues(
        resolveTokens({ site: siteTokens(samplePage(domain, '/')!) })
      )
      const html = renderEmail({
        blocks,
        brand: { ...sampleBrand, tokens }
      })
      drawn[look] = {
        desk: await measure(browser, html, desktopWindow),
        phone: await measure(browser, html, phoneWindow)
      }
      try {
        writeFileSync(
          join(dir, `blocks-${look}.jpg`),
          await pictureOf(browser, html, desktopWindow)
        )
        writeFileSync(
          join(dir, `blocks-${look}.phone.jpg`),
          await pictureOf(browser, html, phoneWindow)
        )
      } catch {
        // A picture that cannot be taken leaves the gate without one.
      }
    }
    const { calm, soft } = drawn as Record<
      'calm' | 'soft',
      { desk: Measured; phone: Measured }
    >
    console.log(JSON.stringify({ calm: calm.desk, soft: soft.desk }))
    // Spaces: the calm site's 8 px unit draws the blocks' spaces at 1.5,
    // the soft site's 6 px unit at 1.25.
    expect(Math.max(...calm.desk.rowPads)).toBeGreaterThan(
      Math.max(...soft.desk.rowPads)
    )
    // Buttons: filled square-cornered capitals, or an outline pill.
    expect(calm.desk.buttons.length).toBeGreaterThan(0)
    for (const b of calm.desk.buttons) {
      expect(b.radius).toBe(4)
      expect(b.border).toBe(0)
      expect(b.background).not.toBe('rgba(0, 0, 0, 0)')
      expect(b.transform).toBe('uppercase')
    }
    for (const b of soft.desk.buttons) {
      expect(b.radius).toBe(24)
      expect(b.border).toBe(2)
      expect(b.background).toBe('rgba(0, 0, 0, 0)')
      expect(b.transform).toBe('none')
    }
    // The same size of button: an outline's line is inside its space.
    expect(calm.desk.buttons[0]!.padTop).toBe(14)
    expect(soft.desk.buttons[0]!.padTop).toBe(10)
    // Pictures' corners and type.
    expect(calm.desk.pictureRadius).toContain(6)
    expect(soft.desk.pictureRadius).toContain(12)
    expect(calm.desk.h1).toBe(36)
    expect(soft.desk.h1).toBe(40)
    // Inside the limits, and nothing wider than a phone.
    for (const m of [calm, soft]) {
      for (const b of m.desk.buttons) expect(b.radius).toBeLessThanOrEqual(24)
      expect(Math.max(...m.desk.rowPads)).toBeLessThanOrEqual(64)
      expect(m.desk.smallest).toBeGreaterThanOrEqual(12)
      expect(m.phone.width).toBeLessThanOrEqual(phoneWindow)
      expect(m.phone.h1).toBeLessThanOrEqual(28)
    }
  }, 300_000)
})
