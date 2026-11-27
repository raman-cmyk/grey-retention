// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import { launch } from '@/lib/sandbox/browser.mjs'
import { fakeDraftPusher } from '@/lib/providers/klaviyo-draft'
import { cutBlocks, checkBlock, dedupe } from '@/features/design-engine/blocks'
import type { Blueprint } from '@/features/design-engine/blueprint'
import {
  desktopWindow,
  measureHtml,
  phoneWindow,
  pictureOf
} from '@/features/design-engine/browser'
import { goldenEmails } from '@/features/design-engine/golden/emails'
import {
  goldenStoreNames,
  testBrand,
  testCropper,
  testProducts,
  testRules,
  testVocabulary,
  testWords
} from '@/features/design-engine/golden/brand'
import {
  libraryCopy,
  withCutsInline
} from '@/features/design-engine/library-copy'
import { blueprintFrom } from '@/features/design-engine/measure'
import type { PhotoTools } from '@/features/design-engine/photos'
import { forStorage } from '@/features/design-engine/stored'
import type { SwapBrand, SwapPicture } from '@/features/design-engine/swap'
import type { EmailType } from '@/features/strategy/plan'
import { hardProblems } from './hard-checks'
import { copyPhotoPath } from './library-copy'
import { withPhotoLinks } from './library-copy-live'
import { composeScratch, planScratch, type LibraryBlock } from './scratch'

/**
 * DES-ENGINE-004b's gate (owner plan of 25 November 2026, step 4 "Scratch
 * from the real library"): the block library is built from the 40 golden
 * emails' sections as the block job builds it (cut, de-duplicated, each
 * distinct block checked), then 10 Scratch emails of different goals are
 * planned from it for the synthetic test brand (`planScratch`), composed
 * and drawn for Klaviyo in the brand's look exactly as the copy job draws
 * them (`libraryCopy`: photos cut, brand swap, structure check, Footer
 * block when needed), checked for anything of every source email (0
 * leaks), through the email's hard checks, and pushed to a fake Klaviyo
 * draft. Pictures go to `DESIGN_GOLDEN_OUT/scratch`.
 */
const on = process.env.DESIGN_ENGINE_BROWSER === 'on'
const out = process.env.DESIGN_GOLDEN_OUT ?? 'design-golden'

vi.mock('server-only', () => ({}))

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
  icons: []
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

/** Ten emails of different goals, with and without an offer. */
const goals: { type: EmailType; offer: boolean; products: number }[] = [
  { type: 'launch', offer: false, products: 3 },
  { type: 'offer', offer: true, products: 2 },
  { type: 'story', offer: false, products: 1 },
  { type: 'education', offer: false, products: 0 },
  { type: 'bestseller', offer: false, products: 3 },
  { type: 'gift guide', offer: false, products: 3 },
  { type: 'restock', offer: false, products: 2 },
  { type: 'reminder', offer: false, products: 2 },
  { type: 'offer', offer: true, products: 3 },
  { type: 'launch', offer: false, products: 2 }
]
export const scratchTarget = 10

describe.skipIf(!on)('Scratch from the real library', () => {
  let browser: Browser
  beforeAll(async () => {
    const { chromium } = await import('@playwright/test')
    browser = await launch(chromium)
  })
  afterAll(async () => {
    await browser?.close()
  })

  it(`builds ${scratchTarget} Scratch emails of different goals from the library, each in the brand's look, 0 leaks, every hard check, a fake Klaviyo draft`, async () => {
    // The library, as the block job builds it.
    const all: {
      email: string
      html: string
      block: ReturnType<typeof cutBlocks>['blocks'][number]
    }[] = []
    for (const email of goldenEmails) {
      const opened = await measureHtml(browser, email.html, desktopWindow)
      if (!opened.ok) continue
      const measured = blueprintFrom(opened.measurement)
      if (!measured.ok) continue
      for (const block of cutBlocks(forStorage(measured.blueprint)).blocks)
        all.push({ email: email.id, html: email.html, block })
    }
    const sources = new Map<string, Set<string>>()
    for (const c of all)
      sources.set(
        c.block.fingerprint,
        (sources.get(c.block.fingerprint) ?? new Set()).add(c.email)
      )
    const library: (LibraryBlock & { blueprint: Blueprint })[] = []
    for (const { block, uses } of dedupe(all.map((a) => a.block))) {
      if (block.unsafe) continue
      if (!(await checkBlock(browser, block.check)).pass) continue
      library.push({
        id: block.fingerprint,
        kind: block.kind,
        facts: block.facts,
        width: block.blueprint.width,
        uses,
        brands: sources.get(block.fingerprint)!.size,
        emailTypes: [],
        yours: false,
        blueprint: block.blueprint
      })
    }
    const htmlOf = new Map(goldenEmails.map((e) => [e.id, e.html]))
    const pusher = fakeDraftPusher()
    const dir = join(out, 'scratch')
    mkdirSync(dir, { recursive: true })
    const rows: string[] = []
    const recent = new Set<string>()
    const picks = new Map<string, string[]>()
    let passed = 0
    let leaks = 0
    for (const [i, goal] of goals.entries()) {
      const id = `scratch-${String(i + 1).padStart(2, '0')}-${goal.type.replace(' ', '-')}`
      const emailProducts = products.slice(0, goal.products)
      const plan = planScratch(library, {
        emailType: goal.type,
        products: emailProducts.length,
        productPhotos: emailProducts.filter((p) => p.photo).length,
        offer: goal.offer,
        logo: !!brand.logo,
        photos: brand.photos?.length ?? 0,
        recent,
        seed: id
      })
      if (!plan.ok) {
        rows.push(`${id}: no plan (${plan.reason})`)
        continue
      }
      for (const b of plan.blocks) recent.add(b.id)
      picks.set(
        id,
        plan.blocks.map((b) => b.id)
      )
      const source = composeScratch(
        plan.blocks.map((b) => library.find((l) => l.id === b.id)!.blueprint)
      )
      const sourceEmails = [
        ...new Set(plan.blocks.flatMap((b) => [...sources.get(b.id)!]))
      ]
      const got = await libraryCopy(browser, {
        source,
        sourceHtml: htmlOf.get(sourceEmails[0]!)!,
        leakSources: sourceEmails.map((e) => ({
          html: htmlOf.get(e)!,
          names: goldenStoreNames
        })),
        sourceNames: goldenStoreNames,
        brand,
        products: emailProducts,
        words: testWords,
        rules: goal.offer ? testRules : { ...testRules, offer: null },
        vocabulary: testVocabulary,
        crop: 'canvas',
        tools,
        mode: 'klaviyo'
      })
      if (!got.ok) {
        rows.push(`${id}: ${got.error}`)
        continue
      }
      leaks += got.leaks.length
      const links = new Map(
        got.cuts.map((_, n) => [
          n,
          `https://project.supabase.co/storage/v1/object/sign/email-copies/${copyPhotoPath('t', 'b', 'l', n)}?token=x`
        ])
      )
      const html = withPhotoLinks(got.html, links)
      const problems = hardProblems(html, {
        maxDiscountPercent: testRules.maxDiscountPercent,
        known: [testBrand.name, ...testProducts.map((p) => p.title)],
        storeHosts: [new URL(testBrand.site).hostname],
        subject: 'Fresh from Fernhill',
        preheader: 'New this week',
        brandName: testBrand.name,
        storeText: []
      })
      const draft = await pusher.createDraft({
        tenantId: 't',
        idempotencyKey: id,
        name: id,
        subject: 'Fresh from Fernhill',
        preheader: 'New this week',
        html,
        plannedSendAt: '2027-01-01T10:00:00+00:00',
        audienceId: 'a',
        sample: true
      })
      const copied = got.sections.filter((s) => s.result === 'copied').length
      const ok = got.pass && !got.leaks.length && !problems.length && draft.ok
      if (ok) passed++
      rows.push(
        `${id}: ${ok ? 'pass' : 'FAIL'} · ${plan.blocks.length} library blocks (${plan.blocks.map((b) => `${b.kind}${b.facts.headline ? ' (headline)' : ''}`).join(', ')}), ${copied} of ${got.sections.length} sections drawn from them${got.footerAdded ? ', Footer block added' : ''}, ${got.leaks.length} leaks, ${problems.length ? problems.map((p) => `${p.check} (${p.problem})`).join('; ') : 'every hard check passed'}${draft.ok ? ', fake Klaviyo draft' : ''}${
          got.pass
            ? ''
            : ` · ${got.sections
                .filter((s) => s.result !== 'copied')
                .map(
                  (s) =>
                    `${s.ordinal}: ${s.fallback?.reason ?? s.problems[0] ?? ''}`
                )
                .join('; ')}`
        }`
      )
      try {
        // The pictures show the test brand's photos (hosted addresses inline).
        let view = withCutsInline(got.html, got.cuts)
        for (const [src, p] of inline) view = view.split(src).join(p.src)
        const [desk, phone] = await Promise.all([
          pictureOf(browser, view, desktopWindow),
          pictureOf(browser, view, phoneWindow)
        ])
        writeFileSync(join(dir, `${id}.jpg`), desk)
        writeFileSync(join(dir, `${id}.phone.jpg`), phone)
      } catch {
        // A picture that cannot be taken leaves the row without one.
      }
    }
    const summary = `# Scratch from the real library: ${passed} of ${goals.length} pass every check, ${leaks} leaks\n\nThe library: ${library.length} blocks that pass the quality check, from the 40 golden emails. Each email is planned from it for the synthetic test brand, drawn for Klaviyo in the brand's look, checked against every source email it took a layout from (0 leaks needed), through the email's hard checks, and pushed to a fake Klaviyo draft.\n\n${rows.map((r) => `- ${r}`).join('\n')}\n`
    writeFileSync(join(dir, 'summary.md'), summary)
    console.log(summary)
    expect(leaks).toBe(0)
    // Variety: two emails of the same goal do not take the same layouts.
    const same = (a: string, b: string) =>
      JSON.stringify(picks.get(a)) === JSON.stringify(picks.get(b))
    expect(same('scratch-01-launch', 'scratch-10-launch')).toBe(false)
    expect(same('scratch-02-offer', 'scratch-09-offer')).toBe(false)
    expect(pusher.calls.length).toBe(
      passed + rows.filter((r) => r.includes('FAIL')).length
    )
    expect(passed).toBeGreaterThanOrEqual(scratchTarget)
  }, 900_000)
})
