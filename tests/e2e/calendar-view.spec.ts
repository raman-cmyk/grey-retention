import { expect, test } from '@playwright/test'
import { login } from './accounts'

test('calendar month grid and view navigation preserve the selected month', async ({
  page
}, info) => {
  await login(page, info.project.name.startsWith('mobile') ? 'other' : 'owner')
  await page.goto('/campaign-agent?m=2024-02&view=calendar')
  await expect(
    page.getByRole('heading', { name: 'February 2024', exact: true })
  ).toBeVisible()
  const calendar = page.getByRole('table', {
    name: 'February 2024 campaign calendar'
  })
  if (info.project.name.startsWith('mobile')) {
    await expect(calendar).toHaveCount(0)
  } else {
    await expect(calendar).toBeVisible()
    await expect(calendar.getByRole('columnheader')).toHaveCount(7)
    await expect(calendar.locator('tbody tr')).toHaveCount(5)
    await expect(calendar.locator('time[datetime="2024-02-29"]')).toBeVisible()
  }
  await page.getByRole('link', { name: 'Next month', exact: true }).click()
  await expect(page).toHaveURL(/m=2024-03(?:&|$)/)
  await expect(
    page.getByRole('heading', { name: 'March 2024', exact: true })
  ).toBeVisible()
  // Calendar | Table (the old List and History views are one table now).
  await page.getByRole('link', { name: 'Table', exact: true }).click()
  await expect(page).toHaveURL(/view=table(?:&|$)/)
  await expect(
    page.getByRole('link', { name: 'Table', exact: true })
  ).toHaveAttribute('aria-current', 'page')
  await page.getByRole('link', { name: 'Previous month', exact: true }).click()
  await expect(page).toHaveURL(/m=2024-02&view=table/)
  await expect(
    page.getByRole('heading', { name: 'February 2024', exact: true })
  ).toBeVisible()
  await page
    .getByRole('link', { name: 'Show replaced entries', exact: true })
    .click()
  await expect(page).toHaveURL(/m=2024-02&view=table&history=1/)
  await expect(
    page.getByRole('link', { name: 'Hide replaced entries', exact: true })
  ).toBeVisible()
  // Filters survive month changes.
  await page
    .getByRole('navigation', { name: 'Filter by status' })
    .getByRole('link', { name: 'Scheduled', exact: true })
    .click()
  await expect(page).toHaveURL(/status=scheduled/)
  await page.getByLabel('Month', { exact: true }).fill('2024-12')
  await page.getByRole('button', { name: 'Show month', exact: true }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('m') === '2024-12' &&
      url.searchParams.get('view') === 'table' &&
      url.searchParams.get('history') === '1' &&
      url.searchParams.get('status') === 'scheduled'
  )
  await expect(
    page.getByRole('heading', { name: 'December 2024', exact: true })
  ).toBeVisible()
  const todayHref = await page
    .getByRole('link', { name: 'Today', exact: true })
    .getAttribute('href')
  await page.getByRole('link', { name: 'Today', exact: true }).click()
  await expect(page).toHaveURL(new URL(todayHref!, page.url()).toString())
  await expect(page.getByLabel('Month', { exact: true })).not.toHaveValue(
    '2024-12'
  )
  expect(new URL(page.url()).searchParams.get('view')).toBe('table')
  await page.getByRole('link', { name: 'Reset', exact: true }).click()
  await expect(page).toHaveURL((url) => !url.searchParams.has('status'))
  // One "+ New" menu replaces the row of create buttons.
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page
    .getByRole('list', { name: 'Create' })
    .getByRole('link', { name: /^Single send/ })
    .click()
  await expect(page.getByLabel('Campaign title')).toBeInViewport()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
