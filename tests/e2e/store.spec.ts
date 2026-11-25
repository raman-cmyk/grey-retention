import { test, expect } from '@playwright/test'
import { login } from './accounts'

// v2 is Klaviyo only (BUILD_BRIEF D2): no Store tab and no Shopify anywhere
// an owner looks. Products, prices and bestsellers come from Klaviyo.
test('V2-D2 Shopify is hidden: no Store tab, and /store opens the Brand page', async ({
  page
}) => {
  await login(page)
  // UI-BRAND: Brand is a GROS page under Settings.
  await page.goto('/store')
  await expect(page).toHaveURL(/\/settings\/brand$/)
  await expect(
    page.getByRole('navigation', { name: 'Brand & Store' })
  ).toHaveCount(0)
  for (const path of [
    '/settings/brand',
    '/settings/brand/book',
    '/settings/assets',
    '/home',
    '/settings',
    '/gros',
    '/plan'
  ]) {
    await page.goto(path)
    await expect(page.locator('main')).toBeVisible()
    // Visible owner text only (the sample tools name the fixture "sample catalog").
    expect(await page.locator('main').innerText()).not.toMatch(/shopify/i)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
  }
})
