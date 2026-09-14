import { expect, test } from '@playwright/test'

test('client login presents a labelled access form', async ({ page }) => {
  await page.goto('/login')
  await expect(
    page.getByRole('heading', { name: 'Return to the work.' })
  ).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
})

test('proof table adapts to desktop and mobile viewports', async ({
  page
}, testInfo) => {
  await page.goto('/dashboard')
  await expect(
    page.getByRole('heading', { name: 'Campaign proof table' })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Active proofs' })
  ).toBeVisible()

  if (testInfo.project.name === 'mobile-chromium') {
    await expect(page.getByText('Copy review').first()).toBeVisible()
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(
      page.getByRole('navigation', {
        name: 'Client workspace mobile navigation'
      })
    ).toBeVisible()
  } else {
    await expect(page.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  }
})
