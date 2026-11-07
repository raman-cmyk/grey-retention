import { expect, test } from '@playwright/test'
import { login } from './accounts'
import { blockTypes } from '../../features/blocks/catalog'
import { renderEmail } from '../../features/blocks/render'
import { sampleBlocks, sampleBrand } from '../../features/blocks/samples'

// BLK-001: every block, rendered as a real email, at desktop email width and
// on a 375px phone. No server or sign-in is needed: the HTML is loaded
// straight into the browser, the way an email client shows it.
const html = renderEmail({
  blocks: blockTypes.map((t) => sampleBlocks[t]),
  brand: sampleBrand,
  subject: 'Block library check',
  mode: 'preview'
})

for (const width of [600, 375])
  test(`BLK-001 all 20 blocks fit a ${width}px screen`, async ({
    page
  }, info) => {
    test.skip(info.project.name.startsWith('mobile'), 'Sets its own width')
    await page.setViewportSize({ width, height: 900 })
    await page.setContent(html)
    const layout = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll('[data-block]')]
      return {
        fits: document.documentElement.scrollWidth <= window.innerWidth,
        types: [...new Set(blocks.map((b) => b.getAttribute('data-block')))],
        empty: blocks
          .filter((b) => (b as HTMLElement).offsetHeight === 0)
          .map((b) => b.getAttribute('data-block')),
        // Columns that stack on a phone: their width as a share of the page.
        stacked: [...document.querySelectorAll('.gr-col')].map(
          (c) => (c as HTMLElement).offsetWidth / window.innerWidth
        ),
        smallestText: Math.min(
          ...[...document.querySelectorAll('p, h1, h2, a, td')]
            .filter((e) => (e.textContent ?? '').trim())
            .map((e) => parseFloat(getComputedStyle(e).fontSize))
        )
      }
    })
    expect(layout.fits).toBe(true)
    expect(layout.types).toEqual(blockTypes)
    expect(layout.empty).toEqual([])
    expect(layout.smallestText).toBeGreaterThanOrEqual(12)
    if (width === 375)
      for (const share of layout.stacked) expect(share).toBeGreaterThan(0.8)
    else for (const share of layout.stacked) expect(share).toBeLessThan(0.6)
  })

test('BLK-002 the block gallery shows all 20 blocks in the brand', async ({
  page
}) => {
  await login(page)
  await page.goto('/library/blocks')
  await expect(
    page.getByRole('heading', { name: 'Block library', level: 1 })
  ).toBeVisible()
  const frames = page.locator('iframe[title$="(sample content)"]')
  await expect(frames).toHaveCount(20)
  await expect(
    page.getByRole('heading', { name: 'Offer banner' })
  ).toBeVisible()
  await page.getByText('Phone · 375px', { exact: true }).click()
  await expect(page.locator('iframe[width="375"]')).toHaveCount(20)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
})
