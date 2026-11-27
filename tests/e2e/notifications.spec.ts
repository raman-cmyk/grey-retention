import { test, expect } from '@playwright/test'
import { newOwner } from './new-owner'

// PICK-107: the owner is told when the plan is ready, opens it from the
// notice, and turns notification emails on (recorded, never sent).
test('PICK-107 owner is told the plan is ready and opens it from the notice', async ({
  page
}) => {
  test.setTimeout(90_000)
  await newOwner(page, { prefix: 'notices', name: 'Notice studio' })
  // Nothing yet: the plain bell.
  const bell = page.getByRole('link', { name: /^Notifications/ })
  await expect(bell).toHaveAccessibleName('Notifications')

  // Plan next 15 days on the sample store (fake AI).
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Plan', exact: true })
    .click()
  await page.getByRole('button', { name: 'Plan next 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Which offers should we run?' })
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('checkbox', { name: /WELCOME15/ }).check()
  await page.getByRole('radio', { name: 'Only the offers I tick' }).check()
  await page.getByRole('button', { name: 'Plan the 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your next 15 days' })
  ).toBeVisible({ timeout: 30_000 })

  // The bell counts it on the next page.
  await page.goto('/home')
  await expect(bell).toHaveAccessibleName('Notifications, 1 new')
  await bell.click()
  await expect(page).toHaveURL(/\/notifications$/)
  await expect(
    page.getByRole('heading', { name: 'Notifications', level: 1 })
  ).toBeVisible()
  await expect(bell).toHaveAttribute('aria-current', 'page')
  const list = page.getByRole('list', { name: 'Notifications' })
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(list).toContainText(/Your 15-day (sample )?plan is ready/)

  // Open marks it read and opens the plan.
  await list.getByRole('button', { name: /^Open: Your 15-day/ }).click()
  await expect(page).toHaveURL(/\/plan$/)
  await expect(bell).toHaveAccessibleName('Notifications')

  // The owner's email switch: on, and the page says nothing is sent.
  await page.goto('/notifications')
  await expect(page.getByRole('button', { name: 'Mark all read' })).toHaveCount(
    0
  )
  const email = page.getByRole('region', { name: 'Email' })
  await email.getByRole('button', { name: 'Turn on emails' }).click()
  await expect(
    page.getByText(
      'Emails are on. This build records each one but sends none yet.'
    )
  ).toBeVisible()
})
