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
  await expect(page).toHaveURL(/m=2024-03&view=calendar/)
  await expect(
    page.getByRole('heading', { name: 'March 2024', exact: true })
  ).toBeVisible()
  await page.getByRole('link', { name: 'List', exact: true }).click()
  await expect(page).toHaveURL(/view=list(?:&|$)/)
  await expect(
    page.getByRole('link', { name: 'List', exact: true })
  ).toHaveAttribute('aria-current', 'page')
  expect(new URL(page.url()).searchParams.get('view')).toBe('list')
  await page.getByRole('link', { name: 'Previous month', exact: true }).click()
  await expect(page).toHaveURL(/m=2024-02&view=list/)
  await expect(
    page.getByRole('heading', { name: 'February 2024', exact: true })
  ).toBeVisible()
  expect(new URL(page.url()).searchParams.get('view')).toBe('list')
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await expect(page).toHaveURL(/m=2024-02&view=history/)
  await expect(
    page.getByText('History includes superseded calendar entries.', {
      exact: false
    })
  ).toBeVisible()
  await page.getByLabel('Month', { exact: true }).fill('2024-12')
  await page.getByRole('button', { name: 'Show month', exact: true }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('m') === '2024-12' &&
      url.searchParams.get('view') === 'history'
  )
  await expect(
    page.getByRole('heading', { name: 'December 2024', exact: true })
  ).toBeVisible()
  expect(new URL(page.url()).searchParams.get('view')).toBe('history')
  const todayHref = await page
    .getByRole('link', { name: 'Today', exact: true })
    .getAttribute('href')
  await page.getByRole('link', { name: 'Today', exact: true }).click()
  await expect(page).toHaveURL(new URL(todayHref!, page.url()).toString())
  await expect(page.getByLabel('Month', { exact: true })).not.toHaveValue(
    '2024-12'
  )
  expect(new URL(page.url()).searchParams.get('view')).toBe('history')
  await page.getByRole('link', { name: 'New campaign', exact: true }).click()
  await expect(page.getByLabel('Campaign title')).toBeInViewport()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
