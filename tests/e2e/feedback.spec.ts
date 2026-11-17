import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

test('UI-SETd the owner sends a feature request on Settings and finds it again', async ({
  page
}) => {
  await newOwner(page, { prefix: 'feedback', name: 'Feedback studio' })
  // The old address opens Settings, where the card is.
  await page.goto('/feedback')
  await expect(page).toHaveURL(/\/settings$/)
  const requests = page.getByRole('region', { name: 'Feature requests' })
  await expect(requests.getByText('No requests yet.')).toBeVisible()

  // A refusal says what to fix and keeps what was typed.
  await requests.getByLabel('Type', { exact: true }).selectOption('improvement')
  await requests.getByLabel('Subject', { exact: true }).fill('D')
  await requests
    .getByLabel('Details', { exact: true })
    .fill('So I can reuse last week’s email without starting over.')
  await requests.getByRole('button', { name: 'Send request' }).click()
  await expect(
    requests.getByText('Subject: at least 2 characters.')
  ).toBeVisible()
  await expect(requests.getByLabel('Subject', { exact: true })).toHaveValue('D')

  const subject = `Duplicate an email ${randomUUID().slice(0, 6)}`
  await requests.getByLabel('Subject', { exact: true }).fill(subject)
  await requests.getByRole('button', { name: 'Send request' }).click()
  await expect(
    requests.getByText('Thanks — your request was sent.')
  ).toBeVisible()
  await expect(requests.getByLabel('Subject', { exact: true })).toHaveValue('')
  const item = requests
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: subject }) })
    .first()
  await expect(item).toContainText('Improve Existing · Open')
  await expect(item).toContainText('You ·')
  await page.reload()
  await expect(item).toContainText('reuse last week’s email')
})

test('UI-SETd staff can send feature requests too', async ({ page }, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/settings')
  const requests = page.getByRole('region', { name: 'Feature requests' })
  const subject = `Staff idea ${randomUUID().slice(0, 6)}`
  await requests.getByLabel('Type', { exact: true }).selectOption('bug')
  await requests.getByLabel('Subject', { exact: true }).fill(subject)
  await requests
    .getByLabel('Details', { exact: true })
    .fill('The preview is blank on my phone.')
  await requests.getByRole('button', { name: 'Send request' }).click()
  await expect(
    requests
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: subject }) })
      .first()
  ).toContainText('Bug · Open')
})
