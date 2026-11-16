import { expect, test, type Page } from '@playwright/test'
import { blockTypes, type Block } from '../../features/blocks/catalog'
import { blockHeight, blockHeights } from '../../features/blocks/heights'
import { blockPreviewDocument } from '../../features/blocks/render'
import { sampleBlocks, sampleBrand } from '../../features/blocks/samples'

// DST-007: how tall the blocks really are, at 600 wide in a desktop
// window (700: the email's phone layout starts under 620), measured in
// Chromium. Product photos are a square picture, as a shop's product
// photos usually are. No server or sign-in is needed.
const square = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
)

async function frameHeight(page: Page, html: string) {
  await page.setContent(html, { waitUntil: 'load' })
  return page.evaluate(() =>
    Math.round(
      (
        document.querySelector('.gr-wrap') as HTMLElement
      ).getBoundingClientRect().height
    )
  )
}

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own width')
  await page.setViewportSize({ width: 700, height: 900 })
  // Every picture is the square photo; nothing reaches out.
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ body: square, contentType: 'image/png' })
      : route.abort()
  )
})

test('DST-007 every block is drawn at the height the plans count on', async ({
  page
}) => {
  const off: string[] = []
  for (const type of blockTypes) {
    const drawn = await frameHeight(
      page,
      blockPreviewDocument(sampleBlocks[type], sampleBrand)
    )
    if (Math.abs(drawn - blockHeights[type]) > 4)
      off.push(`${type}: drawn ${drawn}, counted ${blockHeights[type]}`)
  }
  // A grid grows by a row of products.
  for (const [type, count] of [
    ['product_grid_2col', 2],
    ['product_grid_3col', 6]
  ] as const) {
    const grid = sampleBlocks[type] as Block & {
      content: { products: unknown[] }
    }
    const products = [...grid.content.products, ...grid.content.products]
    const drawn = await frameHeight(
      page,
      blockPreviewDocument(
        {
          ...grid,
          content: { ...grid.content, products: products.slice(0, count) }
        } as Block,
        sampleBrand
      )
    )
    if (Math.abs(drawn - blockHeight(type, count)) > 4)
      off.push(
        `${type} with ${count}: drawn ${drawn}, counted ${blockHeight(type, count)}`
      )
  }
  expect(off).toEqual([])
})
