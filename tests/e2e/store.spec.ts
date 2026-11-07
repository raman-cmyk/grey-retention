import { randomBytes } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

const token = () =>
  `shpat_${randomBytes(24).toString('base64url').replace(/[-_]/g, 'x').slice(0, 30)}`

async function connectShopify(page: Page) {
  await page.goto('/connections')
  await page
    .getByRole('button', { name: /^(Connect Shopify|Update access token)$/ })
    .click()
  const form = page.locator('section', {
    has: page.getByRole('heading', { name: 'Connect your Shopify store' })
  })
  await form
    .getByLabel('Shop domain')
    .fill(`store-${randomBytes(3).toString('hex')}.myshopify.com`)
  await form.getByLabel('Admin API access token').fill(token())
  await form.getByRole('button', { name: 'Verify & connect' }).click()
  await expect(form.getByText(/^Shopify connected\./)).toBeVisible()
}

test('UIR-005 the Store tab shows a store dashboard once Shopify is connected', async ({
  page
}) => {
  await newOwner(page, { prefix: 'store', name: 'Store studio' })
  // Without Shopify: the empty state, with the sub-tabs still there.
  await page.goto('/store')
  await expect(page).toHaveTitle(/Store Intelligence/)
  await expect(
    page.getByRole('heading', {
      name: 'Connect Shopify to see Store Intelligence'
    })
  ).toBeVisible()
  await expect(
    page
      .getByRole('navigation', { name: 'Brand & Store' })
      .getByRole('link', { name: 'Brand profile', exact: true })
  ).toBeVisible()

  await connectShopify(page)
  await page.goto('/store')
  await expect(
    page.getByRole('heading', { name: 'Store Intelligence', level: 2 })
  ).toBeVisible()
  // Honest: the orders and customers are samples.
  await expect(page.getByText('Sample orders and customers')).toBeVisible()
  await expect(
    page.getByText(/The orders and customers below are examples/)
  ).toBeVisible()
  for (const name of [
    'Revenue · 30 days',
    'Orders · 30 days',
    'Average order',
    'Returning customers'
  ])
    await expect(page.getByText(name, { exact: true })).toBeVisible()

  const trend = page.getByRole('region', { name: 'Revenue trend' })
  await expect(trend.getByRole('img')).toBeVisible()
  // The daily table opens by keyboard.
  await trend.getByText('Show revenue per day as a table').focus()
  await page.keyboard.press('Enter')
  await expect(trend.getByRole('table')).toBeVisible()
  await expect(trend.getByRole('row')).toHaveCount(31)

  const customers = page.getByRole('region', { name: 'Top customers' })
  await expect(customers.getByRole('row')).toHaveCount(6)

  // Stock alerts come from the workspace's own catalogue.
  const stock = page.getByRole('region', { name: 'Stock alerts' })
  await expect(stock).toBeVisible()
  await expect(
    stock
      .getByText(/No products in your catalogue yet/)
      .or(stock.getByText(/products are in stock/))
      .or(stock.getByText(/Out of stock|Low stock|not checked/).first())
  ).toBeVisible()

  // The same numbers after a reload (sample data does not jump).
  const revenue = await page
    .getByText('Revenue · 30 days', { exact: true })
    .locator('xpath=following-sibling::dd[1]')
    .textContent()
  await page.reload()
  await expect(
    page
      .getByText('Revenue · 30 days', { exact: true })
      .locator('xpath=following-sibling::dd[1]')
  ).toHaveText(revenue ?? '')
})

test('UIR-005 staff see the Store tab but are not asked to connect', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/store')
  const empty = page.getByRole('heading', {
    name: 'Connect Shopify to see Store Intelligence'
  })
  const dashboard = page.getByRole('heading', {
    name: 'Store Intelligence',
    level: 2
  })
  // The seed workspace may or may not have Shopify connected by now.
  await expect(empty.or(dashboard)).toBeVisible()
  if (await empty.isVisible()) {
    await expect(
      page.getByText('Ask your workspace owner to connect Shopify.')
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Go to Connections' })
    ).toHaveCount(0)
  } else {
    await expect(
      page.getByRole('region', { name: 'Stock alerts' })
    ).toBeVisible()
  }
})

test('UIR-005 the Store dashboard fits 375px', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await newOwner(page, { prefix: 'store375', name: 'Store narrow studio' })
  await connectShopify(page)
  await page.goto('/store')
  await expect(
    page.getByRole('region', { name: 'Top customers' })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
