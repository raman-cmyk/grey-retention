import { test, expect } from '@playwright/test'
import { newOwner } from './new-owner'

// UI-PLAN-b: "Plan next 15 days" on the sample store (fake AI), on the GROS
// Plan screen.
test('UI-PLAN-b owner plans the next 15 days, picks an offer and creates an email', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  await newOwner(page, { prefix: 'plan', name: 'Plan studio' })
  // Home's top bar opens the plan, on a laptop and a phone alike.
  const menu = page.getByRole('navigation', { name: 'Main' })
  await menu.getByRole('link', { name: 'Plan', exact: true }).click()
  await expect(page).toHaveURL(/\/plan$/)
  await expect(
    page.getByRole('heading', { name: 'Plan', level: 1 })
  ).toBeVisible()
  await expect(
    menu.getByRole('link', { name: 'Plan', exact: true })
  ).toHaveAttribute('aria-current', 'page')

  // No plan yet: one button.
  await expect(page.getByRole('heading', { name: 'No plan yet' })).toBeVisible()
  await page.getByRole('button', { name: 'Plan next 15 days' }).click()

  // The store is read in the background; then the owner picks the offers.
  await expect(
    page.getByRole('heading', { name: 'Which offers should we run?' })
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/BIGSALE40 is not offered/)).toBeVisible()
  await expect(page.getByText(/sample store/).first()).toBeVisible()

  // Ticks with "You choose" are refused, not silently dropped.
  await page.getByRole('checkbox', { name: /CANDLE10/ }).check()
  await page.getByRole('button', { name: 'Plan the 15 days' }).click()
  await expect(
    page.getByText(
      'You ticked offers: choose “Only the offers I tick”, or untick them.'
    )
  ).toBeVisible()
  await page.getByRole('checkbox', { name: /CANDLE10/ }).uncheck()

  // One offer, ticked.
  await page.getByRole('checkbox', { name: /WELCOME15/ }).check()
  await page.getByRole('radio', { name: 'Only the offers I tick' }).check()
  await page.getByRole('button', { name: 'Plan the 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your next 15 days' })
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByText(/the AI was not used for this plan/)
  ).toBeVisible()
  const emails = page.getByRole('list', { name: 'The emails' })
  expect(await emails.getByRole('listitem').count()).toBeGreaterThan(0)
  // Only the ticked offer runs.
  await expect(emails.getByText(/with CANDLE10/)).toHaveCount(0)
  if (process.env.PLAN_SHOT)
    await page.screenshot({
      path: `${process.env.PLAN_SHOT}/plan-${info.project.name}.png`,
      fullPage: true
    })

  // Create email on the next planned email builds it and puts it into
  // Klaviyo as a draft (the fake pusher: a sample draft, never In Klaviyo).
  await emails.getByRole('button', { name: 'Create email' }).first().click()
  await expect(
    emails.getByText(/Sample draft, not in Klaviyo/).first()
  ).toBeVisible({ timeout: 30_000 })
  await emails.getByRole('link', { name: 'Open' }).first().click()
  await expect(page).toHaveURL(/\/plan\/email\/[0-9a-f-]{36}$/)
  await expect(page.getByText(/this is a sample draft/)).toBeVisible()
  await page.goto('/plan')

  // Reloading keeps the plan; a new plan can start.
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Your next 15 days' })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Plan again' })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
