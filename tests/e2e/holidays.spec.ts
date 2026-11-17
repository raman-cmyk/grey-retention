import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

// A date about two weeks ahead, as the date field expects it.
function soon(days = 14) {
  const at = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(at)
}

test('UI-SETd the owner adds, edits and deletes a date and picks a country', async ({
  page
}) => {
  await newOwner(page, { prefix: 'holidays', name: 'Holidays studio' })
  // Settings opens the page; the old address does too.
  await page.goto('/settings')
  await page
    .getByRole('region', { name: 'Holidays and events' })
    .getByRole('link', { name: 'Open holidays' })
    .click()
  await expect(page).toHaveURL(/\/settings\/holidays$/)
  await page.goto('/holidays')
  await expect(page).toHaveURL(/\/settings\/holidays$/)
  await expect(page).toHaveTitle(/Holidays and events/)
  await expect(
    page.getByRole('heading', { name: 'Holidays and events', level: 1 })
  ).toBeVisible()
  const dates = page.getByRole('region', { name: 'Your dates' })
  await expect(dates.getByText('No dates yet.')).toBeVisible()

  // The country: guessed from the timezone, then the owner's choice.
  const platform = page.getByRole('region', { name: 'Holidays in the plan' })
  await expect(platform).toContainText('Guessed from your timezone')
  await expect(platform).toContainText('kept up to date by Grey Retention')
  await platform.getByLabel('Country').selectOption('AU')
  await platform.getByRole('button', { name: 'Save country' }).click()
  await expect(platform.getByText('Country saved.')).toBeVisible()
  await expect(platform.getByLabel('Country')).toHaveValue('AU')
  await expect(platform).not.toContainText('Guessed from your timezone')
  await page.reload()
  await expect(platform.getByLabel('Country')).toHaveValue('AU')
  expect(await platform.getByRole('listitem').count()).toBeGreaterThan(0)

  // Add.
  const name = `Summer drop ${randomUUID().slice(0, 6)}`
  const add = page.getByRole('region', { name: 'Add a date' })
  await add.getByLabel('Name', { exact: true }).fill(name)
  await add.getByLabel('Date', { exact: true }).fill(soon())
  await add.getByLabel('Type', { exact: true }).selectOption('event')
  await add.getByRole('checkbox', { name: 'Every year' }).check()
  await add
    .getByLabel('Notes for GROS (optional)')
    .fill('Tease it a week early.')
  await add.getByRole('button', { name: 'Add date' }).click()
  await expect(add.getByText(`Added “${name}”.`)).toBeVisible()
  await expect(add.getByLabel('Name', { exact: true })).toHaveValue('')
  const row = dates.getByRole('listitem').filter({ hasText: name })
  await expect(row).toContainText('Event · Every year · Tease it a week early.')

  // Edit: the form opens with its values, and says it saved.
  await row.getByRole('link', { name: `Edit: ${name}` }).click()
  await expect(page).toHaveURL(/\?edit=/)
  const edit = page.getByRole('region', { name: `Edit ${name}` })
  await expect(edit.getByLabel('Name', { exact: true })).toHaveValue(name)
  const renamed = `${name} sale`
  await edit.getByLabel('Name', { exact: true }).fill(renamed)
  await edit.getByRole('button', { name: 'Save date' }).click()
  const saved = page.getByRole('region', { name: `Edit ${renamed}` })
  await expect(saved.getByText('Saved.', { exact: true })).toBeVisible()
  await expect(dates.getByText(renamed, { exact: true })).toBeVisible()
  await saved.getByRole('link', { name: 'Stop editing' }).click()
  // No Saved. is left behind, and the cursor waits in Name.
  const again = page.getByRole('region', { name: 'Add a date' })
  await expect(again.getByLabel('Name', { exact: true })).toBeFocused()
  await expect(again.getByText('Saved.', { exact: true })).toHaveCount(0)

  // Delete, after the confirm; the answer stays though the row has gone.
  page.once('dialog', (dialog) => void dialog.accept())
  await dates.getByRole('button', { name: `Delete: ${renamed}` }).click()
  await expect(dates.getByText('Deleted.', { exact: true })).toBeVisible()
  await expect(dates.getByText('No dates yet.')).toBeVisible()
})

test('UI-SETd staff see the dates but cannot change them', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/settings/holidays')
  await expect(
    page.getByRole('heading', { name: 'Holidays and events', level: 1 })
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Add a date' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Delete/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^Edit:/ })).toHaveCount(0)
  await expect(page.getByLabel('Country')).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: 'Holidays in the plan' })
  ).toBeVisible()
})

test('UI-SETd Holidays fits 375px', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page, 'owner')
  await page.goto('/settings/holidays')
  await expect(
    page.getByRole('heading', { name: 'Holidays and events', level: 1 })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})
