import { test, expect } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

test('UIR-011 owner sets campaign defaults on every tab and saves once', async ({
  page
}) => {
  await newOwner(page, { prefix: 'settings', name: 'Settings studio' })
  await page.goto('/settings')
  await expect(
    page.getByRole('heading', { name: 'Settings', level: 1 })
  ).toBeVisible()
  await expect(page).toHaveTitle(/Settings/)

  // The timezone is the workspace's (the same one the Dashboard uses).
  await expect(page.getByText('Asia/Kathmandu (UTC+05:45)')).toBeVisible()
  await expect(page.locator('time')).toHaveText(
    /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} \d{4} · \d{1,2}:\d{2} [AP]M$/
  )

  // Opens on Featured Product; this workspace has no products yet.
  await expect(
    page.getByRole('tab', { name: 'Featured Product' })
  ).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText(/No products yet/)).toBeVisible()

  await page.getByRole('tab', { name: 'Sender Name' }).click()
  await page
    .getByRole('textbox', { name: 'Sender name', exact: true })
    .fill('Settings Studio Team')
  await page.getByRole('tab', { name: 'Primary Link' }).click()
  const link = page.getByRole('textbox', { name: 'Primary link', exact: true })
  await link.fill('settings-studio.example/new')
  // The browser checks the address first; the server says the same.
  await link.evaluate((input: HTMLInputElement) => (input.type = 'text'))
  await page.getByRole('button', { name: 'Save defaults' }).click()
  await expect(
    page.getByText('Primary link: use a full address that starts with https://')
  ).toBeVisible()
  await link.fill('https://settings-studio.example/new')

  // Audiences come from Klaviyo; it is not connected in this workspace.
  await page.getByRole('tab', { name: 'Audience' }).click()
  await expect(
    page.getByText('Connect Klaviyo to choose lists and segments.').first()
  ).toBeVisible()

  await page.getByRole('tab', { name: 'Email Settings' }).click()
  await page.getByLabel(/Include footer/).uncheck()
  await expect(page.getByText('Applies to new campaigns only.')).toBeVisible()
  await page.getByRole('button', { name: 'Save defaults' }).click()
  await expect(
    page.getByText('Defaults saved. New campaigns will start with them.')
  ).toBeVisible()

  await page.reload()
  await page.getByRole('tab', { name: 'Sender Name' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Sender name', exact: true })
  ).toHaveValue('Settings Studio Team')
  await page.getByRole('tab', { name: 'Primary Link' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Primary link', exact: true })
  ).toHaveValue('https://settings-studio.example/new')
  await page.getByRole('tab', { name: 'Email Settings' }).click()
  await expect(page.getByLabel(/Include footer/)).not.toBeChecked()
})

test('UIR-011 staff see the defaults but cannot change them', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/settings')
  await expect(
    page.getByText('Only the workspace owner can change these.')
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save defaults' })).toHaveCount(
    0
  )
  // Staff can still look through the tabs; the fields are read-only.
  await page.getByRole('tab', { name: 'Sender Name' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Sender name', exact: true })
  ).toBeDisabled()
})

test('UIR-011 Settings fits 375px and the tabs work by keyboard', async ({
  page
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page, 'owner')
  await page.goto('/settings')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.getByRole('tab', { name: 'Featured Product' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Sender Name' })).toBeFocused()
  await expect(
    page.getByRole('textbox', { name: 'Sender name', exact: true })
  ).toBeVisible()
})
