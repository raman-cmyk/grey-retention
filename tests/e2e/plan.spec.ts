import { test, expect } from '@playwright/test'
import { newOwner } from './new-owner'

// STR-003 part 2: "Plan next 15 days" on the sample store (fake AI).
test('STR-003 owner plans the next 15 days and picks an offer', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  await newOwner(page, { prefix: 'plan', name: 'Plan studio' })
  if (info.project.name.startsWith('mobile')) {
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page
      .locator('dialog[open]')
      .getByRole('link', { name: 'Plan next 15 days' })
      .click()
  } else
    await page.getByRole('link', { name: 'Plan next 15 days' }).first().click()
  await expect(page).toHaveURL(/\/plan$/)
  await expect(
    page.getByRole('heading', { name: 'Plan next 15 days', level: 1 })
  ).toBeVisible()

  // The owner starts the plan; the store is read in the background.
  await page.getByRole('button', { name: 'Plan next 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Which offers should we run?' })
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/BIGSALE40 is not offered/)).toBeVisible()

  // One offer, ticked.
  await page.getByRole('checkbox', { name: /WELCOME15/ }).check()
  await page.getByRole('radio', { name: 'Run the offers I ticked' }).check()
  await page.getByRole('button', { name: 'Plan the 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: /^Your emails from / })
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByText(/the AI was not used for this plan/)
  ).toBeVisible()
  const emails = page.getByRole('listitem').filter({ hasText: 'Why:' })
  expect(await emails.count()).toBeGreaterThan(0)
  // Only the ticked offer runs.
  await expect(page.getByText(/% off with CANDLE10$/)).toHaveCount(0)

  // Reloading keeps the plan; a new plan can start.
  await page.reload()
  await expect(
    page.getByRole('heading', { name: /^Your emails from / })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Plan again' })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
