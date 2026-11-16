import { test, expect } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

test('UI-SETa the owner sets the biggest discount and adds and removes a code', async ({
  page
}) => {
  await newOwner(page, { prefix: 'settings', name: 'Settings studio' })
  await page.goto('/settings')
  await expect(
    page.getByRole('heading', { name: 'Settings', level: 1 })
  ).toBeVisible()
  await expect(page).toHaveTitle(/Settings/)
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'aria-current',
    'page'
  )

  // The timezone is the workspace's, with the store's time now.
  const zone = page.getByRole('region', { name: 'Timezone' })
  await expect(zone.getByText('Asia/Kathmandu (UTC+05:45)')).toBeVisible()
  await expect(zone.locator('time')).toHaveText(
    /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} \d{4} · \d{1,2}:\d{2} [AP]M$/
  )

  const max = page.getByRole('region', { name: 'Biggest discount' })
  await expect(max).toContainText('Not set')
  await max.getByLabel('Percent off, 0 to 100').fill('120')
  await max.getByRole('button', { name: 'Save biggest discount' }).click()
  await expect(
    max.getByText('Enter a whole number from 0 to 100.')
  ).toBeVisible()
  // A refusal keeps what was typed.
  await expect(max.getByLabel('Percent off, 0 to 100')).toHaveValue('120')
  await max.getByLabel('Percent off, 0 to 100').fill('20')
  await max.getByRole('button', { name: 'Save biggest discount' }).click()
  await expect(
    max.getByText('Saved. New emails offer at most 20% off.')
  ).toBeVisible()
  await page.reload()
  await expect(max.getByText('20%', { exact: true })).toBeVisible()

  const codes = page.getByRole('region', { name: 'Discount codes' })
  await expect(codes.getByText('No codes yet.', { exact: false })).toBeVisible()
  await codes.getByLabel('Code', { exact: true }).fill('WELCOME15')
  await codes.getByLabel('Percent off', { exact: true }).fill('15')
  await codes.getByRole('button', { name: 'Add code' }).click()
  await expect(
    codes.getByText('Added WELCOME15. Agents can use it in new emails.')
  ).toBeVisible()
  const row = codes.getByRole('listitem').filter({ hasText: 'WELCOME15' })
  await expect(row).toContainText('15% off · No end date')
  // The same code again is refused, and the fields keep it.
  await codes.getByLabel('Code', { exact: true }).fill('WELCOME15')
  await codes.getByLabel('Percent off', { exact: true }).fill('15')
  await codes.getByRole('button', { name: 'Add code' }).click()
  await expect(
    codes.getByText('WELCOME15 is already in your list.')
  ).toBeVisible()
  await expect(codes.getByLabel('Code', { exact: true })).toHaveValue(
    'WELCOME15'
  )
  await codes.getByRole('button', { name: 'Remove: WELCOME15' }).click()
  await expect(row).toHaveCount(0)
  // The answer stays though its row has gone.
  await expect(
    codes.getByText('Removed. New emails will not use it.')
  ).toBeVisible()

  // Klaviyo is not connected here; the team and the account link on.
  const klaviyo = page.getByRole('region', { name: 'Klaviyo', exact: true })
  await expect(klaviyo.getByText('Needs you')).toBeVisible()
  await expect(
    klaviyo.getByRole('button', { name: 'Connect Klaviyo' })
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Team' }).getByText('Members')
  ).toBeVisible()
  await page
    .getByRole('region', { name: 'Account' })
    .getByRole('link', { name: 'Change' })
    .click()
  await expect(page).toHaveURL(/\/profile$/)
})

test('UI-SETa staff see Settings without the owner’s controls', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/settings')
  await expect(
    page.getByRole('heading', { name: 'Settings', level: 1 })
  ).toBeVisible()
  for (const name of [
    'Save biggest discount',
    'Add code',
    'Remove',
    'Connect Klaviyo',
    'Change key',
    'Disconnect',
    'Save timezone'
  ])
    await expect(page.getByRole('button', { name })).toHaveCount(0)
  await expect(
    page.getByText('Only the workspace owner can change Klaviyo.')
  ).toBeVisible()
  await expect(page.getByLabel('Change timezone')).toHaveCount(0)
})

test('UI-SETa Settings fits 375px', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page, 'owner')
  await page.goto('/settings')
  await expect(
    page.getByRole('heading', { name: 'Settings', level: 1 })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
