import { expect, test } from '@playwright/test'
import { login } from './accounts'

test('UI-AUDa Audiences lists segments and lists, opens one and comes back', async ({
  page
}) => {
  await login(page, 'owner')
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Audiences', exact: true })
    .click()
  await expect(page).toHaveURL(/\/audiences$/)
  await expect(
    page.getByRole('heading', { name: 'Audiences', level: 1 })
  ).toBeVisible()
  const segments = page.getByRole('region', { name: 'Segments' })
  await expect(segments.getByText(/Sample Klaviyo data/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Lists' })).toBeVisible()
  await segments.getByRole('link', { name: 'Open' }).first().click()
  await expect(page).toHaveURL(/\/segments\//)
  await page.getByRole('link', { name: 'Back to Audiences' }).click()
  await expect(page).toHaveURL(/\/audiences$/)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
