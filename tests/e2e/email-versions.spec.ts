import { test, expect } from '@playwright/test'
import { newOwner } from './new-owner'

// PICK-106: the email GROS made is kept as its first version, and the
// email's page lists it (sample store, fake AI, the fake pusher).
test('PICK-106 an email’s page lists the version GROS made', async ({
  page
}) => {
  test.setTimeout(90_000)
  await newOwner(page, { prefix: 'versions', name: 'Versions studio' })
  await page.goto('/plan')
  await page.getByRole('button', { name: 'Plan next 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Which offers should we run?' })
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Plan the 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your next 15 days' })
  ).toBeVisible({ timeout: 30_000 })
  const emails = page.getByRole('list', { name: 'The emails' })
  await emails.getByRole('button', { name: 'Create email' }).first().click()
  await expect(
    emails.getByText(/Sample draft, not in Klaviyo/).first()
  ).toBeVisible({ timeout: 30_000 })
  await emails.getByRole('link', { name: 'Open' }).first().click()
  await expect(page).toHaveURL(/\/plan\/email\/[0-9a-f-]{36}$/)

  const versions = page.getByRole('region', { name: 'Versions' })
  await expect(versions).toBeVisible()
  const lines = versions.getByRole('link')
  await expect(lines).toHaveCount(1)
  await expect(lines.first()).toHaveText(
    /^Version 1 · Today \d{1,2}:\d{2} · Made from scratch · Current/
  )
  await expect(lines.first()).toHaveAttribute('aria-current', 'true')
  // One version: nothing older to bring back.
  await expect(
    page.getByRole('button', { name: 'Use this version' })
  ).toHaveCount(0)
  // Asking for a version that is not kept shows the current one.
  await page.goto(`${page.url()}?version=7`)
  await expect(
    page.getByRole('region', { name: 'Versions' }).getByRole('link')
  ).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Version 7' })).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
