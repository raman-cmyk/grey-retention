import { test, expect } from '@playwright/test'
import { login } from './accounts'

// v2 is Klaviyo only (BUILD_BRIEF D2): no Store tab and no Shopify anywhere
// an owner looks. Products, prices and bestsellers come from Klaviyo.
test('V2-D2 Shopify is hidden: no Store tab, and /store opens the Brand page', async ({
  page
}) => {
  await login(page)
  await page.goto('/store')
  await expect(page).toHaveURL(/\/brand$/)
  await expect(
    page.getByRole('navigation', { name: 'Brand & Store' })
  ).toHaveCount(0)
  for (const path of ['/brand', '/connections', '/dashboard', '/settings']) {
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
