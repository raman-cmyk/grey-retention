import { expect, test } from '@playwright/test'
import { login } from './accounts'

test('UIR-025 designer desk filters by status and fits small screens', async ({
  page
}) => {
  await login(page, 'designer')
  await expect(
    page.getByRole('heading', { name: 'Assignment desk', level: 1 })
  ).toBeVisible()
  const tabs = page.getByRole('navigation', { name: 'Assignment status' })
  await tabs.getByRole('link', { name: /^All \(\d+\)$/ }).click()
  await expect(page).toHaveURL(/\/designer\/dashboard\?show=all$/)
  await expect(
    tabs.getByRole('link', { name: /^All \(\d+\)$/ })
  ).toHaveAttribute('aria-current', 'page')
  await tabs.getByRole('link', { name: /^Approved \(\d+\)$/ }).click()
  await expect(page).toHaveURL(/show=approved$/)
  // Notification email is simulated, and an empty list says so too.
  await expect(
    page.getByRole('heading', { name: 'Notifications' })
  ).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

test('UIR-025 a brief that is not yours is not found, and owners stay out', async ({
  page
}) => {
  await login(page, 'designer')
  await page.goto('/designer/assignments/33333333-3333-4333-8333-333333333333')
  await expect(
    page.getByRole('heading', { name: 'Nothing is pinned here.' })
  ).toBeVisible()
  await page.context().clearCookies()
  await login(page, 'owner')
  await page.goto('/designer/dashboard')
  await expect(page).toHaveURL(/\/designer\/login/)
})
