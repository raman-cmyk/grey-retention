// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import { launch } from '@/lib/sandbox/browser.mjs'
import { partsOf, type Blueprint } from '@/features/design-engine/blueprint'
import { desktopWindow, measureHtml } from '@/features/design-engine/browser'
import { uploadEmails } from '@/features/design-engine/golden/uploads'
import { compareBlueprints } from '@/features/design-engine/likeness'
import { blueprintFrom } from '@/features/design-engine/measure'
import { isBare } from '@/features/design-engine/stored'
import { measureUpload } from './measure'
import { placeholderIndex, prepareUpload } from './prepare'

/**
 * DES-ENGINE-003a gate: the 20 upload-shaped golden emails, made ready as
 * an owner's upload is (`prepareUpload`: every picture an empty drawing of
 * its own size, its placeholder beside it) and measured as the upload job
 * measures them (`measureUpload`), as the brand's own design and as
 * another brand's email. The prepared email must measure like the file
 * itself (at least 18 of 20, the engine's likeness check), an own design
 * keeps every picture it carried (its placeholders) and another brand's
 * blueprint keeps no picture and no link. Needs Chromium:
 * `DESIGN_ENGINE_BROWSER=on`.
 */
const on = process.env.DESIGN_ENGINE_BROWSER === 'on'
export const uploadMeasureTarget = 18

const images = (bp: Blueprint) =>
  bp.sections.flatMap((s) => partsOf(s.items)).filter((p) => p.type === 'image')

describe.skipIf(!on)('uploaded emails measured (DES-ENGINE-003a)', () => {
  let browser: Browser
  beforeAll(async () => {
    const { chromium } = await import('@playwright/test')
    browser = await launch(chromium)
  })
  afterAll(async () => {
    await browser?.close()
  })

  it(`measures at least ${uploadMeasureTarget} of the 20 upload-shaped emails as the files themselves, both ways`, async () => {
    expect(uploadEmails).toHaveLength(20)
    const rows: string[] = []
    let alike = 0
    for (const email of uploadEmails) {
      const direct = await measureHtml(browser, email.html, desktopWindow)
      expect(direct.ok, email.id).toBe(true)
      if (!direct.ok) continue
      const original = blueprintFrom(direct.measurement)
      expect(original.ok, email.id).toBe(true)
      if (!original.ok) continue

      const own = await prepareUpload(email.html, [], 'own')
      expect(own.ok, email.id).toBe(true)
      if (!own.ok) continue
      expect(own.missing, email.id).toEqual([])
      const measured = await measureUpload(
        browser,
        own.html,
        'own',
        own.pictures.length
      )
      expect(measured.ok, email.id).toBe(true)
      if (!measured.ok) continue
      // Every picture it carried is kept, at its placeholder.
      for (const p of images(measured.blueprint))
        if (p.type === 'image' && p.src)
          expect(
            placeholderIndex(p.src),
            `${email.id} ${p.src.slice(0, 40)}`
          ).not.toBeNull()
      const likeness = compareBlueprints(original.blueprint, measured.blueprint)
      if (likeness.pass) alike++
      rows.push(
        `${email.id}: ${
          likeness.pass
            ? 'alike'
            : likeness.problems
                .concat(likeness.sections.flatMap((s) => s.problems))
                .slice(0, 3)
                .join('; ')
        }`
      )

      const other = await prepareUpload(email.html, [], 'other')
      expect(other.ok && other.pictures, email.id).toEqual([])
      if (!other.ok) continue
      const bare = await measureUpload(browser, other.html, 'other', 0)
      expect(bare.ok, email.id).toBe(true)
      if (bare.ok) expect(isBare(bare.blueprint), email.id).toBe(true)
    }
    console.log(`Uploads measured alike: ${alike} of 20\n${rows.join('\n')}`)
    expect(alike).toBeGreaterThanOrEqual(uploadMeasureTarget)
  }, 600_000)
})
