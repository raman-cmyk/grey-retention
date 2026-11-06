import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

test('UIR-020 owner sends a feature request and finds it again', async ({
  page
}) => {
  await newOwner(page, { prefix: 'feedback', name: 'Feedback studio' })
  // The sidebar links here now (no longer "Soon").
  await page.goto('/dashboard')
  await expect(
    page
      .locator('a[href="/feedback"]', { hasText: 'Request a Feature' })
      .first()
  ).toBeAttached()
  await page.goto('/feedback')
  await expect(
    page.getByRole('heading', { name: 'Feature Requests', level: 1 })
  ).toBeVisible()
  await expect(page).toHaveTitle(/Feature Requests/)
  await expect(page.getByText('Nothing here yet')).toBeVisible()
  await expect(page.getByRole('radio', { name: 'All 0' })).toBeChecked()

  // Cancel saves nothing.
  await page.getByRole('button', { name: 'New request' }).first().click()
  let dialog = page.getByRole('dialog', { name: 'Request a Feature' })
  await expect(dialog.getByRole('button', { name: 'Send' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Nothing here yet')).toBeVisible()

  // Send stays disabled until subject and details are filled.
  const subject = `Duplicate campaign ${randomUUID().slice(0, 6)}`
  await page.getByRole('button', { name: 'New request' }).first().click()
  dialog = page.getByRole('dialog', { name: 'Request a Feature' })
  await expect(
    dialog.getByRole('radio', { name: /Feature Request/ })
  ).toBeChecked()
  await dialog.getByRole('radio', { name: /Improve Existing/ }).check()
  await dialog.getByLabel('Subject').fill(subject)
  await expect(dialog.getByRole('button', { name: 'Send' })).toBeDisabled()
  await dialog
    .getByLabel('Details')
    .fill('So I can reuse last week’s email without starting over.')
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Thanks — your request was sent.')).toBeVisible()

  const item = page.getByRole('listitem').filter({ hasText: subject })
  await expect(item).toContainText('Improve Existing')
  await expect(item).toContainText('Open')
  await expect(item).toContainText('You ·')
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Open 1' })).toBeVisible()
  await page.getByPlaceholder('Search your requests…').fill('reuse last week')
  await expect(
    page.getByRole('listitem').filter({ hasText: subject })
  ).toBeVisible()
  await page.getByPlaceholder('Search your requests…').fill('no such thing')
  await expect(page.getByText('No requests match.')).toBeVisible()
})

test('UIR-020 staff can send requests too', async ({ page }, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/feedback')
  await page.getByRole('button', { name: 'New request' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Request a Feature' })
  const subject = `Staff idea ${randomUUID().slice(0, 6)}`
  await dialog.getByRole('radio', { name: /Bug/ }).check()
  await dialog.getByLabel('Subject').fill(subject)
  await dialog.getByLabel('Details').fill('The preview is blank on my phone.')
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(
    page.getByRole('listitem').filter({ hasText: subject })
  ).toContainText('Bug')
})

test('UIR-020 Feature Requests fits 375px', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page, 'owner')
  await page.goto('/feedback')
  await expect(
    page.getByRole('heading', { name: 'Feature Requests', level: 1 })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
