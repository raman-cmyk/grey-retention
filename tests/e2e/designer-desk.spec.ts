import { expect, test } from '@playwright/test'
import { login } from './accounts'

test('UIR-025 designer desk filters by status', async ({ page }) => {
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
  await expect(
    page.getByRole('heading', { name: 'Notifications' })
  ).toBeVisible()
})

test('UIR-025 designer desk fits a 375px screen', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page, 'designer')
  for (const show of ['all', 'todo']) {
    await page.goto(`/designer/dashboard?show=${show}`)
    await expect(
      page.getByRole('heading', { name: 'Assignment desk', level: 1 })
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
  }
})

test('UIR-025 an unknown or unassigned brief is not found; owners and staff stay out', async ({
  page
}) => {
  await login(page, 'designer')
  await page.goto('/designer/assignments/33333333-3333-4333-8333-333333333333')
  await expect(
    page.getByRole('heading', { name: 'Nothing is pinned here.' })
  ).toBeVisible()
  for (const role of ['owner', 'staff'] as const) {
    await page.context().clearCookies()
    await login(page, role)
    await page.goto('/designer/dashboard')
    await expect(page).toHaveURL(/\/designer\/login/)
  }
})
