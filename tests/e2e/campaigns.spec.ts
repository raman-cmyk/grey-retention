import { expect, test } from '@playwright/test'
import { login } from './accounts'
test('UC-05 owner creates, edits, refreshes and approves a persisted calendar version', async ({
  page
}, testInfo) => {
  await login(page)
  await page.goto('/campaign-agent')
  const title = `Synthetic browser proof ${Date.now()}`
  await page.getByLabel('Campaign title').fill(title)
  await page
    .getByLabel('Goal and approved facts')
    .fill('A fictional, non-discounted update. No invented claims.')
  await page
    .getByLabel('Audience', { exact: true })
    .selectOption({ label: 'G | Engaged (fixture definition)' })
  await page
    .getByRole('button', { name: 'Create campaign', exact: true })
    .click()
  await expect(page).toHaveURL(/\/campaigns\//)
  await page.getByLabel('Campaign title').fill(`${title} revised`)
  await page.getByRole('button', { name: 'Save calendar revision' }).click()
  await expect(
    page.getByRole('heading', { name: `${title} revised`, exact: true })
  ).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Campaign title')).toHaveValue(
    `${title} revised`
  )
  await page.getByRole('button', { name: 'Approve calendar v2' }).click()
  await expect(
    page.getByRole('button', { name: 'Approve calendar v2' })
  ).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole('button', { name: /Approve calendar/ })
  ).toHaveCount(0)
  await expect(page.getByText(/calendar v2 ·/)).toBeVisible()
  await page.screenshot({
    path: `.audit/calendar-${testInfo.project.name}.png`,
    fullPage: true
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  const url = page.url()
  await page.context().clearCookies()
  await login(page, 'staff')
  await page.goto(url)
  await expect(
    page.getByRole('button', { name: /Approve calendar/ })
  ).toHaveCount(0)
  await page.context().clearCookies()
  await login(page, 'other')
  await page.goto(url)
  await expect(
    page.getByRole('heading', { name: `${title} revised` })
  ).toHaveCount(0)
})
