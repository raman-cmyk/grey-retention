import { test, expect } from '@playwright/test'
import { newOwner } from './new-owner'

// PICK-102: "Create all emails" on the sample store's plan (fake AI, fake
// draft pusher: sample drafts, never Klaviyo). A second tab's click makes
// no second build.
test('PICK-102 owner creates every email of the plan at once, with progress', async ({
  page
}) => {
  test.setTimeout(180_000)
  await newOwner(page, { prefix: 'allmail', name: 'All emails studio' })
  await page.goto('/plan')
  await page.getByRole('button', { name: 'Plan next 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Which offers should we run?' })
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('radio', { name: 'No offers this time' }).check()
  await page.getByRole('button', { name: 'Plan the 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your next 15 days', exact: true })
  ).toBeVisible({ timeout: 60_000 })

  const emails = page.getByRole('list', { name: 'The emails' })
  await expect(emails.getByRole('listitem').first()).toBeVisible()
  const total = await emails.getByRole('listitem').count()
  expect(total).toBeGreaterThan(1)
  const createAll = page.getByRole('button', {
    name: `Create all ${total} emails`
  })
  await expect(createAll).toBeVisible()

  // Another tab still shows the button.
  const other = await page.context().newPage()
  await other.goto('/plan')
  const otherButton = other.getByRole('button', {
    name: `Create all ${total} emails`
  })
  await expect(otherButton).toBeVisible()

  await createAll.click()
  await expect(
    page.getByText(new RegExp(`^Creating ${total} emails\\.`))
  ).toBeVisible({ timeout: 30_000 })

  // The other tab's click queues nothing new.
  await otherButton.click()
  await expect(
    other.getByText('Every email in this plan is already made or being made.')
  ).toBeVisible({ timeout: 30_000 })
  await other.close()

  // Every email ends as a sample draft, one per planned email.
  await expect(emails.getByText(/Sample draft, not in Klaviyo/)).toHaveCount(
    total,
    { timeout: 120_000 }
  )
  await expect(emails.getByRole('listitem')).toHaveCount(total)
  await expect(page.getByRole('button', { name: /^Create all / })).toHaveCount(
    0
  )
  await expect(page.getByRole('button', { name: 'Create email' })).toHaveCount(
    0
  )
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
