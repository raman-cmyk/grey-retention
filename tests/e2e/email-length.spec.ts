import { expect, test, type Page } from '@playwright/test'
import { blockTypes, type Block } from '../../features/blocks/catalog'
import {
  blockHeight,
  blockHeights,
  heroButtonRow
} from '../../features/blocks/heights'
import { blockPreviewDocument, renderEmail } from '../../features/blocks/render'
import { sampleBlocks, sampleBrand } from '../../features/blocks/samples'

// DST-007: how tall the blocks really are, at 600 wide in a desktop
// window (700: the email's phone layout starts under 620), measured in
// Chromium with the block library's samples (their words, item counts
// and inline pictures). The samples' font falls back to the runner's
// serif, so a block may be a few px off: within 4%, at least 8 px.
const near = (drawn: number, counted: number) =>
  Math.abs(drawn - counted) <= Math.max(8, counted * 0.04)

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
  // A studio picture is drawn 1,200 px wide at twice its height (`?h=`);
  // nothing else reaches out (the samples' pictures are inline).
  await page.route('**/*', (route) => {
    const h = Number(new URL(route.request().url()).searchParams.get('h'))
    return route.request().resourceType() === 'image' && h > 0
      ? route.fulfill({
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${h * 2}"><rect width="1200" height="${h * 2}" fill="#c96"/></svg>`,
          contentType: 'image/svg+xml'
        })
      : route.abort()
  })
})

/** A hero the studio drew, its picture `height` px tall at 600 wide. */
const studioHero = (height: number): Block => {
  const hero = sampleBlocks.hero_product as Block & {
    content: Record<string, unknown>
  }
  return {
    ...hero,
    content: {
      ...hero.content,
      picture: {
        src: `https://cdn.shop.example/hero.jpg?h=${height}`,
        alt: 'The new linen throw',
        height,
        render: '00000001-3333-4333-8333-333333333333'
      }
    }
  } as Block
}

test('DST-007 every block is drawn at the height the plans count on', async ({
  page
}) => {
  const off: string[] = []
  for (const type of blockTypes) {
    const drawn = await frameHeight(
      page,
      blockPreviewDocument(sampleBlocks[type], sampleBrand)
    )
    if (!near(drawn, blockHeights[type]))
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
    if (!near(drawn, blockHeight(type, count)))
      off.push(
        `${type} with ${count}: drawn ${drawn}, counted ${blockHeight(type, count)}`
      )
  }
  // A hero the studio drew: its picture, then its live button's row.
  for (const height of [600, 1000]) {
    const drawn = await frameHeight(
      page,
      blockPreviewDocument(studioHero(height), sampleBrand)
    )
    if (drawn !== height + heroButtonRow)
      off.push(`studio hero ${height}: drawn ${drawn}`)
  }
  expect(off).toEqual([])
})

test('DST-007 a designed email is drawn as tall as its storyboard counts', async ({
  page
}) => {
  const blocks = [
    sampleBlocks.header_logo,
    studioHero(900),
    sampleBlocks.text,
    sampleBlocks.product_feature,
    sampleBlocks.cta,
    sampleBlocks.footer
  ]
  const counted =
    blockHeights.header_logo +
    900 +
    heroButtonRow +
    blockHeights.text +
    blockHeights.product_feature +
    blockHeights.cta +
    blockHeights.footer
  const drawn = await frameHeight(
    page,
    renderEmail({ blocks, brand: sampleBrand, mode: 'preview' })
  )
  expect(near(drawn, counted), `drawn ${drawn}, counted ${counted}`).toBe(true)
})
